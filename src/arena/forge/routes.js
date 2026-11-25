/**
 * HTTP routes for Pulse Forge. Mounted by the Arena router.
 * Entry still goes through submitPrediction. No prize or autopay changes.
 */
import rateLimit from "express-rate-limit";
import { publicBaseUrl } from "../../discovery.js";
import { parseRoundId } from "../rounds.js";
import { normalizeWallet } from "../verify.js";
import { getRoundResults, getReferrerDashboardForRequest, submitPrediction } from "../index.js";
import {
  describeForgeCatalog,
  listAssetPresets,
  listForgeTemplates,
  listSignalModules,
} from "./signals.js";
import {
  configureForgeBot,
  enterForgeBot,
  forgeConfigMessage,
  getForgeBot,
  getForgeBotStore,
  previewForgeBot,
} from "./bots.js";
import { forgeXpLeaderboard, progressionDetail, readProgress } from "./progress.js";
import { renderRoundCardSvg, renderShareHtml, renderStreakCardSvg, shareUrls } from "./cards.js";

function forgeLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: Number(process.env.FORGE_RATE_LIMIT_MAX || 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Pulse Forge is rate limited. Slow down." },
  });
}

function sendError(res, err) {
  const body = {
    error: err.code || "forge_failed",
    message: err.message,
  };
  if (err.asset) body.asset = err.asset;
  if (err.signMessage) body.messageToSign = err.signMessage;
  if (err.price != null) body.price = err.price;
  res.status(err.status || 400).json(body);
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function requireWallet(raw) {
  try {
    return normalizeWallet(raw).wallet;
  } catch (err) {
    throw Object.assign(new Error(err.message), { code: err.code || "invalid_wallet", status: 400 });
  }
}

export function mountForgeRoutes(app) {
  const limit = forgeLimiter();

  app.get("/v1/forge", (_req, res) => {
    res.json(describeForgeCatalog());
  });

  app.get("/v1/forge/modules", (_req, res) => {
    res.json({ modules: listSignalModules() });
  });

  app.get("/v1/forge/templates", (_req, res) => {
    res.json({ templates: listForgeTemplates(), assetPresets: listAssetPresets() });
  });

  app.post("/v1/forge/config-message", limit, (req, res) => {
    try {
      res.json(forgeConfigMessage(req.body || {}));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/v1/forge/bots", limit, (req, res) => {
    try {
      const result = configureForgeBot(req.body || {});
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/bots/:wallet", (req, res) => {
    try {
      res.json({ bot: getForgeBot(req.params.wallet) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/v1/forge/preview", limit, (req, res) => {
    try {
      res.json(previewForgeBot(req.body || {}));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/v1/forge/enter", limit, (req, res) => {
    try {
      const body = req.body || {};
      const result = enterForgeBot({
        wallet: body.wallet,
        roundId: body.roundId,
        snapshot: body.snapshot,
        signatures: body.signatures,
        ref: body.ref,
        submitPrediction,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/progress/:wallet", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      let bot = null;
      try {
        bot = getForgeBot(wallet);
      } catch {
        bot = null;
      }
      res.json({ ...progressionDetail(wallet), bot });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/leaderboard", (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json(forgeXpLeaderboard({ limit }));
  });

  app.get("/v1/forge/referrals", (req, res) => {
    try {
      const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
      res.json(getReferrerDashboardForRequest(wallet));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/share/:roundId/:wallet", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      parseRoundId(req.params.roundId);
      const urls = shareUrls({ baseUrl: publicBaseUrl(req), roundId: req.params.roundId, wallet });
      const progress = readProgress(wallet);
      res.json({
        roundId: req.params.roundId,
        wallet,
        ref: wallet,
        progression: progress,
        ...urls,
        note: "Share link carries ref=<payout wallet>. Non-cash. Prize autopay is unchanged.",
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/cards/round/:roundId/:wallet.svg", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      const roundId = req.params.roundId;
      parseRoundId(roundId);
      const results = getRoundResults(roundId);
      const row =
        (results.ranking || []).find((r) => r.wallet === wallet) ||
        (results.predictions || []).find((p) => p.wallet === wallet);
      if (!row) {
        res.status(404).json({ error: "not_found", message: "no entry for this wallet in that round" });
        return;
      }
      const progress = row.progression || readProgress(wallet);
      const svg = renderRoundCardSvg({
        roundId,
        wallet,
        botName: row.botName,
        rank: row.rank,
        avgAbsPctError: row.avgAbsPctError,
        level: progress.level,
        xp: progress.xp,
        accuracyStreak: progress.accuracyStreak,
        badges: progress.badges,
      });
      res.set("Cache-Control", "public, max-age=60");
      res.type("image/svg+xml").send(svg);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/v1/forge/cards/streak/:wallet.svg", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      const progress = progressionDetail(wallet);
      const bot = getForgeBotStore().get(wallet);
      if (!progress.roundsScored && !bot) {
        res.status(404).json({ error: "not_found", message: "no Pulse Forge progress for this wallet" });
        return;
      }
      const svg = renderStreakCardSvg({
        wallet,
        botName: bot?.botName || progress.botName,
        level: progress.level,
        xp: progress.xp,
        accuracyStreak: progress.accuracyStreak,
        bestAccuracyStreak: progress.bestAccuracyStreak,
        badges: progress.badges,
      });
      res.set("Cache-Control", "public, max-age=60");
      res.type("image/svg+xml").send(svg);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/arena/forge/share/:roundId/:wallet", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      const roundId = req.params.roundId;
      parseRoundId(roundId);
      const results = getRoundResults(roundId);
      const row = (results.ranking || []).find((r) => r.wallet === wallet);
      if (!row) {
        res.status(404).type("html").send("<h1>No result card for that wallet</h1>");
        return;
      }
      const urls = shareUrls({ baseUrl: publicBaseUrl(req), roundId, wallet });
      const progress = row.progression || readProgress(wallet);
      const err = row.avgAbsPctError == null ? "unscored" : `${Number(row.avgAbsPctError).toFixed(4)}% avg error`;
      const html = renderShareHtml({
        title: `${row.botName || "Bot"} · Pulse Forge ${roundId}`,
        description: `Rank #${row.rank ?? "—"} · ${err} · Lv ${progress.level} · streak ${progress.accuracyStreak}. Ref ${wallet}`,
        pageUrl: urls.pageUrl,
        imageUrl: urls.imageUrl,
        heading: row.botName || "Pulse Forge result",
        lines: [
          `Round ${roundId} · rank #${row.rank ?? "—"} · ${err}`,
          `Level ${progress.level} · ${progress.xp} XP · accuracy streak ${progress.accuracyStreak}`,
          `Referral code: ${wallet}`,
        ],
      });
      res.type("html").send(html);
    } catch (err) {
      res.status(err.status || 400).type("html").send(`<h1>Bad share link</h1><p>${escHtml(err.message || err)}</p>`);
    }
  });

  app.get("/arena/forge/streak/:wallet", (req, res) => {
    try {
      const wallet = requireWallet(req.params.wallet);
      const progress = progressionDetail(wallet);
      const bot = getForgeBotStore().get(wallet);
      if (!progress.roundsScored && !bot) {
        res.status(404).type("html").send("<h1>No streak card for that wallet</h1>");
        return;
      }
      const urls = shareUrls({ baseUrl: publicBaseUrl(req), roundId: progress.lastRoundId || "streak", wallet });
      const name = bot?.botName || progress.botName || "Bot";
      const html = renderShareHtml({
        title: `${name} · ${progress.accuracyStreak}-round Pulse Forge streak`,
        description: `Level ${progress.level} · ${progress.xp} XP · best streak ${progress.bestAccuracyStreak}. Ref ${wallet}`,
        pageUrl: urls.streakPageUrl,
        imageUrl: urls.streakImageUrl,
        heading: `${name} streak`,
        lines: [
          `${progress.accuracyStreak}-round accuracy streak (best ${progress.bestAccuracyStreak})`,
          `Level ${progress.level} · ${progress.xp} XP`,
          `Referral code: ${wallet}`,
        ],
      });
      res.type("html").send(html);
    } catch (err) {
      res.status(err.status || 400).type("html").send(`<h1>Bad share link</h1><p>${escHtml(err.message || err)}</p>`);
    }
  });
}
