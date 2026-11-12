/**
 * Express routes for the free Crypto Pulse Prediction Arena.
 */
import rateLimit from "express-rate-limit";
import { publicBaseUrl } from "../discovery.js";
import {
  deletePredictionAdmin,
  exportWinners,
  getArenaHistory,
  arenaHistoryToCsv,
  getCurrentRound,
  getLeaderboard,
  getWeeklyLeaderboard,
  getPrizeStatus,
  getRules,
  getRoundById,
  getRoundResults,
  listHouseWalletsPublic,
  setPayoutAdmin,
  signingHelp,
  startArenaScorer,
  submitPrediction,
  getArenaEntry,
  getReferrerDashboard,
  deleteReferralAdmin,
  decorateWithPrizeEligibility,
  applyPrizeEligibilityHeaders,
} from "./index.js";
import { currentWeekId } from "./prizes.js";
import { renderArenaHtml } from "./page.js";
import { renderResultsIndexHtml, renderRoundResultsHtml } from "./results-page.js";

function adminAuthorized(req) {
  const expected = (process.env.ARENA_ADMIN_TOKEN || "").trim();
  if (!expected) return false;
  const hdr = req.get("authorization") || "";
  const bearer = hdr.toLowerCase().startsWith("bearer ")
    ? hdr.slice(7).trim()
    : "";
  const q = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const got = bearer || q;
  if (!got || got.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return mismatch === 0;
}

function toCsv(exportData) {
  const lines = [
    "type,id,amountUsdc,wallet,botName,score,roundsEntered,paid,payoutStatus,paidAt,pendingAt,txSignature,explorer,paidUtcDay,error,eligible,note",
  ];
  for (const r of [...(exportData.daily || []), ...(exportData.weekly || [])]) {
    lines.push(
      [
        r.type,
        r.roundId || r.weekId,
        r.amountUsdc,
        r.wallet || "",
        JSON.stringify(r.botName || ""),
        r.score ?? "",
        r.roundsEntered ?? "",
        r.paid,
        r.payoutStatus || "",
        r.paidAt || "",
        r.pendingAt || "",
        r.txSignature || "",
        r.explorer || "",
        r.paidUtcDay || "",
        JSON.stringify(r.error || ""),
        r.eligible,
        JSON.stringify(r.note || ""),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function mountArena(app) {
  const predictLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.ARENA_RATE_LIMIT_MAX || 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "rate_limited",
      message: "Arena predict limited. Slow down.",
    },
  });

  app.get("/arena", async (req, res) => {
    try {
      const current = getCurrentRound();
      const leaderboard = getLeaderboard(current.roundId);
      const weekly = getWeeklyLeaderboard(currentWeekId());
      const prizeStatus = await getPrizeStatus();
      const html = renderArenaHtml({
        current,
        leaderboard,
        weekly,
        rules: getRules(),
        baseUrl: publicBaseUrl(req),
        prizeStatus,
      });
      res.type("html").send(html);
    } catch (err) {
      console.error("arena page error", String(err?.message || err));
      res.status(500).type("html").send("<h1>Arena temporarily unavailable</h1>");
    }
  });

  app.get("/v1/arena/rules", async (_req, res) => {
    const prize = await getPrizeStatus();
    res.json({
      ...getRules(),
      signing: signingHelp(),
      prizeWallet: prize.wallet,
      autopayEnabled: prize.autopayEnabled,
      recentPayouts: prize.recentPayouts,
    });
  });

  app.get("/v1/arena/prize-wallet", async (_req, res) => {
    try {
      res.json(await getPrizeStatus());
    } catch (err) {
      res.status(500).json({ error: "prize_status_failed", message: String(err?.message || err) });
    }
  });

  app.get("/v1/arena/round", (req, res) => {
    try {
      const id = typeof req.query.round === "string" ? req.query.round.trim() : "";
      const round = id ? getRoundById(id) : getCurrentRound();
      res.json({
        service: "crypto-pulse-api",
        arena: "prediction",
        ...round,
        signing: signingHelp({ roundId: round.roundId }),
      });
    } catch (err) {
      res.status(400).json({ error: err.code || "bad_request", message: err.message });
    }
  });

  app.get("/v1/arena/leaderboard", (req, res) => {
    try {
      const id = typeof req.query.round === "string" ? req.query.round.trim() : "";
      res.json(getLeaderboard(id || undefined));
    } catch (err) {
      res.status(400).json({ error: err.code || "bad_request", message: err.message });
    }
  });

  app.get("/v1/arena/leaderboard/weekly", (req, res) => {
    try {
      const week =
        typeof req.query.week === "string" && req.query.week.trim()
          ? req.query.week.trim()
          : currentWeekId();
      res.json(getWeeklyLeaderboard(week));
    } catch (err) {
      res.status(400).json({ error: err.code || "bad_request", message: err.message });
    }
  });

  app.post("/v1/arena/predict", predictLimiter, (req, res) => {
    const body = { ...(req.body || {}) };
    if (!String(body.ref || "").trim()) {
      const hdr = req.get("x-pulse-referrer") || req.get("x-arena-referrer") || "";
      if (String(hdr).trim()) body.ref = String(hdr).trim();
    }
    const eligCtx = {
      wallet: body.wallet,
      botName: body.botName,
      roundId: body.roundId,
      req,
    };
    try {
      const result = submitPrediction(body);
      applyPrizeEligibilityHeaders(res, result);
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      const payload = decorateWithPrizeEligibility(
        {
          error: err.code || "predict_failed",
          message: err.message,
          lifecycle: err.lifecycle,
          cutoffAt: err.cutoffAt,
        },
        eligCtx,
      );
      applyPrizeEligibilityHeaders(res, payload);
      res.status(err.status || 400).json(payload);
    }
  });

  app.get("/v1/arena/entry", (req, res) => {
    try {
      const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
      const roundId = typeof req.query.round === "string" ? req.query.round.trim() : "";
      const payload = getArenaEntry({ wallet, roundId: roundId || undefined, req });
      applyPrizeEligibilityHeaders(res, payload);
      res.json(payload);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "bad_request", message: err.message });
    }
  });

  app.get("/v1/arena/referrals", (req, res) => {
    try {
      const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
      res.json(getReferrerDashboard(wallet));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "bad_request", message: err.message });
    }
  });


  app.get("/arena/results", (req, res) => {
    try {
      const history = getArenaHistory({ limit: 60, includePredictions: false });
      const html = renderResultsIndexHtml({
        rounds: history.rounds,
        baseUrl: publicBaseUrl(req),
      });
      res.type("html").send(html);
    } catch (err) {
      console.error("arena results index error", String(err?.message || err));
      res.status(500).type("html").send("<h1>Results unavailable</h1>");
    }
  });

  app.get("/arena/results/:roundId", (req, res) => {
    try {
      const results = getRoundResults(req.params.roundId);
      res.type("html").send(renderRoundResultsHtml({ results, baseUrl: publicBaseUrl(req) }));
    } catch (err) {
      res.status(400).type("html").send(`<h1>Bad round</h1><p>${String(err.message || err)}</p>`);
    }
  });

  app.get("/v1/arena/results/:roundId", (req, res) => {
    try {
      res.json(getRoundResults(req.params.roundId));
    } catch (err) {
      res.status(400).json({ error: err.code || "bad_request", message: err.message });
    }
  });

  const historyLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.ARENA_HISTORY_RATE_LIMIT_MAX || 60),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Arena history limited. Slow down." },
  });

  app.get("/v1/arena/history", historyLimiter, (req, res) => {
    try {
      const limit = Number(req.query.limit || 30);
      const includePredictions = String(req.query.predictions || "1") !== "0";
      const data = getArenaHistory({ limit, includePredictions });
      const format = String(req.query.format || "json").toLowerCase();
      if (format === "csv") {
        res.type("text/csv").send(arenaHistoryToCsv(getArenaHistory({ limit, includePredictions: true })));
      } else {
        res.json(data);
      }
    } catch (err) {
      res.status(400).json({ error: err.code || "history_failed", message: err.message });
    }
  });

  app.get("/v1/arena/house-bots", (_req, res) => {
    res.json({
      houseBots: listHouseWalletsPublic(),
      note: "Official house bots (official-*). Shown on leaderboards with house:true; never prize-eligible or autopaid.",
    });
  });

  app.get("/v1/arena/admin/export", (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const roundId =
        typeof req.query.round === "string" ? req.query.round.trim() : "";
      const weekId =
        typeof req.query.week === "string" ? req.query.week.trim() : "";
      const data = exportWinners({
        roundId: roundId || undefined,
        weekId: weekId || undefined,
      });
      const format = String(req.query.format || "json").toLowerCase();
      if (format === "csv") {
        res.type("text/csv").send(toCsv(data));
      } else {
        res.json(data);
      }
    } catch (err) {
      res.status(400).json({ error: err.code || "export_failed", message: err.message });
    }
  });

  app.post("/v1/arena/admin/payout", (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const body = req.body || {};
      const result = setPayoutAdmin({
        type: body.type,
        id: body.id || body.roundId || body.weekId,
        paid: body.paid,
        note: body.note,
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({
        error: err.code || "payout_update_failed",
        message: err.message,
      });
    }
  });

  app.delete("/v1/arena/admin/prediction", (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const body = req.body || {};
    const roundId = String(body.roundId || req.query.roundId || "").trim();
    const wallet = String(body.wallet || req.query.wallet || "").trim();
    const asset = String(body.asset || req.query.asset || "").trim().toUpperCase() || null;
    if (!roundId || !wallet) {
      return res.status(400).json({ error: "roundId_and_wallet_required" });
    }
    const deleted = deletePredictionAdmin({ roundId, wallet, asset });
    res.json({ ok: true, deleted });
  });

  app.delete("/v1/arena/admin/referral", (req, res) => {
    if (!adminAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const body = req.body || {};
    const wallet = String(body.wallet || req.query.wallet || "").trim();
    if (!wallet) {
      return res.status(400).json({ error: "wallet_required" });
    }
    try {
      res.json(deleteReferralAdmin({ wallet }));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "referral_delete_failed", message: err.message });
    }
  });

  startArenaScorer();
}
