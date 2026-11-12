/**
 * Crypto Pulse Prediction Arena — public API used by HTTP + MCP.
 * Free entry. Automatic USDC payouts from the public prize wallet while funded.
 */
import { ArenaStore } from "./store.js";
import {
  ARENA_ASSETS,
  arenaRules,
  currentEntryRound,
  parseRoundId,
  prizePoolLabel,
  prizePoolShort,
  prizeSummary,
  recentClosableRoundIds,
  roundStatusAt,
} from "./rounds.js";
import {
  DAILY_PRIZE_USDC,
  WEEKLY_PRIZE_USDC,
  FIRST_WEEK_START,
  currentWeekId,
  weekIdFromRoundId,
  weekBounds,
} from "./prizes.js";
import { buildWeeklyLeaderboard } from "./weekly.js";
import { processAutopay, listPublicPayoutHistory, autopayEnabled } from "./autopay.js";
import { getPrizeWalletPublicStatus, resolvePrizeWalletAddress } from "./wallet.js";
import { verifyPredictionSignature, buildCanonicalMessage, normalizePrice, normalizeAsset, sanitizeBotName } from "./verify.js";
import { buildLeaderboard, scoreRound } from "./scoring.js";
import {
  HOUSE_BOT_DEFS,
  isHouseEntrant,
  isReservedHouseName,
  isHouseWallet,
  listHouseWalletsPublic,
  startHouseBotScheduler,
  runHouseBotEntries,
  ensureHouseWalletsFile,
  houseBotsEnabled,
} from "./house.js";
import { describePulseEligibilityRule, NO_PULSE_REASON, pulseQualification } from "../pulse-usage.js";
import { publicBaseUrl } from "../discovery.js";
import {
  bindReferral,
  getReferralView,
  getReferrerDashboard,
  getReferralStore,
  refreshReferralProgress,
  processReferralPayouts,
  referralAdminSummary,
  walletHasPrediction,
  describeReferralProgram,
} from "./referrals.js";

let storeSingleton = null;
let scorerTimer = null;

export function getStore() {
  if (!storeSingleton) storeSingleton = new ArenaStore();
  return storeSingleton;
}

/** Test helper */
export function _setStoreForTests(store) {
  storeSingleton = store;
}

export function getArenaPublicConfig() {
  return {
    assets: ARENA_ASSETS,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    prizes: prizeSummary(),
    rulesUrl: "/v1/arena/rules",
    pageUrl: "/arena",
    resultsUrl: "/arena/results",
    historyUrl: "/v1/arena/history",
    houseBots: listHouseWalletsPublic(),
    houseBotsNote:
      "Bots named official-* are operator house bots. They appear on the board for transparency but are ineligible for prizes and autopay (house:true, eligible:false).",
    pulseEligibility: describePulseEligibilityRule(),
  };
}

export function describeRound(meta, store) {
  const ensured = store.ensureRound(meta);
  const lifecycle = roundStatusAt(meta);
  // Reflect lock in persisted status without clobbering scored.
  if (ensured.status !== "scored") {
    if (lifecycle === "locked" || lifecycle === "closed") {
      if (ensured.status !== lifecycle) store.setRoundStatus(meta.roundId, lifecycle === "closed" ? "locked" : "locked");
    } else if (lifecycle === "open" && ensured.status !== "open") {
      store.setRoundStatus(meta.roundId, "open");
    }
  }
  const round = store.getRound(meta.roundId);
  const { rows, incomplete } = buildLeaderboard(round);
  const entryCounts = {};
  for (const a of ARENA_ASSETS) entryCounts[a] = 0;
  const wallets = new Set();
  for (const p of round.predictions) {
    entryCounts[p.asset] = (entryCounts[p.asset] || 0) + 1;
    wallets.add(p.wallet);
  }
  return {
    roundId: meta.roundId,
    openAt: meta.openAt,
    cutoffAt: meta.cutoffAt,
    closeAt: meta.closeAt,
    status: round.status === "scored" ? "scored" : lifecycle === "upcoming" ? "upcoming" : lifecycle,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    prizes: prizeSummary(),
    dailyPrizeUsdc: DAILY_PRIZE_USDC,
    assets: ARENA_ASSETS,
    entryCounts,
    uniqueWallets: wallets.size,
    closes: round.closes,
    scoredAt: round.scoredAt,
    leaderboardTop: rows.slice(0, 10),
    incompleteCount: incomplete.length,
    acceptingEntries: lifecycle === "open",
    prizeWinner: rows.find((r) => r.prizeEligible && r.prizeRank === 1) || null,
    houseBotsActive: houseBotsEnabled(),
  };
}

export function getCurrentRound() {
  const store = getStore();
  const meta = currentEntryRound();
  return describeRound(meta, store);
}

export function getRoundById(roundId) {
  const store = getStore();
  const meta = parseRoundId(roundId);
  return describeRound(meta, store);
}

export function getRules() {
  return { ...arenaRules(), referrals: describeReferralProgram() };
}

export function getLeaderboard(roundId) {
  const store = getStore();
  const meta = parseRoundId(roundId || currentEntryRound().roundId);
  store.ensureRound(meta);
  const round = store.getRound(meta.roundId);
  const { rows, incomplete, prizeWinner } = buildLeaderboard(round);
  return {
    roundId: meta.roundId,
    status: round.status,
    closes: round.closes,
    scoredAt: round.scoredAt,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    dailyPrizeUsdc: DAILY_PRIZE_USDC,
    ranking: rows,
    incomplete: incomplete.map((r) => {
      const house = isHouseEntrant({ wallet: r.wallet, botName: r.botName });
      const pulse = pulseQualification({ wallet: r.wallet, roundId: meta.roundId });
      const prizeEligible = !house && pulse.qualified;
      let ineligibleReason = null;
      if (house) ineligibleReason = "house bot";
      else if (pulse.applies && !pulse.qualified) ineligibleReason = NO_PULSE_REASON;
      return {
        ...r,
        house,
        pulseQualified: pulse.qualified,
        prizeEligible,
        eligible: prizeEligible,
        ineligibleReason,
      };
    }),
    prizeWinner: prizeWinner || null,
    pulseEligibility: describePulseEligibilityRule(),
    houseBotsNote:
      "Rows with house:true / eligible:false are official operator bots and cannot win prizes. Starting with round 2026-11-13, prize eligibility also requires a /v1/pulse call on the qualifying UTC day (X-Pulse-Client-Id or payer wallet = payout wallet).",
  };
}

export function getWeeklyLeaderboard(weekId) {
  const store = getStore();
  return buildWeeklyLeaderboard(store, weekId || undefined);
}

export function signingHelp(example = {}) {
  const round = example.roundId || currentEntryRound().roundId;
  const wallet = example.wallet || "<base58-solana-pubkey>";
  const asset = example.asset || "BTC";
  const priceCanonical = example.priceCanonical || "100000";
  const botName = example.botName || "";
  const message = buildCanonicalMessage({
    roundId: round,
    wallet,
    asset,
    priceCanonical,
    botName,
  });
  return {
    algorithm: "ed25519 (Solana wallet keypair)",
    encoding: "signature as base58",
    message,
    note: "Sign the exact UTF-8 bytes of message. Server never receives private keys.",
  };
}

/**
 * Submit or update a prediction. Throws errors with .code and .status.
 */

/**
 * Machine-readable prize-eligibility notice for predict / entry responses.
 * Existing fields stay unchanged; this object is additive.
 *
 * House bots: applicable=false, no warning (notice is not applicable).
 */
export function buildPrizeEligibility({ wallet, botName, roundId, baseUrl, req } = {}) {
  const base = String(baseUrl || publicBaseUrl(req) || "https://cryptopulseapi.com").replace(/\/$/, "");
  let meta;
  try {
    meta = parseRoundId(roundId || currentEntryRound().roundId);
  } catch {
    meta = currentEntryRound();
  }
  const w = String(wallet || "").trim();
  const house = isHouseEntrant({ wallet: w, botName });
  const pulse = pulseQualification({ wallet: w, roundId: meta.roundId });
  const docs = `${base}/v1/arena/rules`;
  const clientId = w || "<payout wallet>";
  const howTo =
    `GET ${base}/v1/pulse with headers X-Crypto-Pulse-Free: 1 and X-Pulse-Client-Id: ${clientId}`;
  const deadline = meta.closeAt;
  if (house) {
    return {
      eligible: false,
      applicable: false,
      requirement:
        "Official house bots (official-*) are never prize-eligible; this /v1/pulse notice is not applicable.",
      howTo,
      deadline,
      docs,
    };
  }
  const applies = pulse.applies;
  const eligible = Boolean(pulse.qualified);
  const requirement = applies
    ? "To be prize-eligible for this daily round, make at least one GET /v1/pulse call during the qualifying UTC day (the 24 hours ending at closeAt), with X-Pulse-Client-Id or the payer wallet equal to your payout wallet."
    : "The /v1/pulse prize-eligibility rule does not apply to this already-closed or pre-enforcement round.";
  return {
    eligible,
    applicable: applies,
    requirement,
    howTo,
    deadline,
    docs,
  };
}

export function prizeEligibilityWarning(info) {
  if (!info || info.applicable === false || info.eligible) return null;
  return (
    `Not prize-eligible: no /v1/pulse call this qualifying UTC day. ${info.howTo} before ${info.deadline}. See ${info.docs}`
  );
}

/** Additive: attaches prizeEligibility (and warning when not eligible) without removing existing fields. */
export function decorateWithPrizeEligibility(body, ctx = {}) {
  const prizeEligibility = buildPrizeEligibility(ctx);
  const warning = prizeEligibilityWarning(prizeEligibility);
  const out = { ...body, prizeEligibility };
  if (warning) out.warning = warning;
  return out;
}

export function applyPrizeEligibilityHeaders(res, payload) {
  if (!res || !payload?.warning) return;
  const notice = String(payload.warning).replace(/[\r\n]+/g, " ").slice(0, 500);
  res.set("X-Arena-Notice", notice);
  const safe = notice.replace(/["\\]/g, "'");
  res.set("Warning", `299 crypto-pulse-api "${safe}"`);
}

export function getArenaEntry({ wallet, roundId, botName, baseUrl, req } = {}) {
  const w = String(wallet || "").trim();
  if (!w) {
    throw Object.assign(new Error("wallet required"), { code: "missing_wallet", status: 400 });
  }
  const store = getStore();
  let meta;
  try {
    meta = parseRoundId(roundId || currentEntryRound().roundId);
  } catch {
    throw Object.assign(new Error("invalid roundId"), { code: "invalid_round", status: 400 });
  }
  store.ensureRound(meta);
  const round = store.getRound(meta.roundId);
  const preds = (round.predictions || []).filter((p) => p.wallet === w);
  const displayName = botName || preds[0]?.botName || null;
  const house = preds.some((p) => p.house) || isHouseEntrant({ wallet: w, botName: displayName });
  const assetsPresent = ARENA_ASSETS.filter((a) => preds.some((p) => p.asset === a));
  const payload = {
    roundId: meta.roundId,
    openAt: meta.openAt,
    cutoffAt: meta.cutoffAt,
    closeAt: meta.closeAt,
    status: round.status === "scored" ? "scored" : roundStatusAt(meta),
    wallet: w,
    botName: displayName,
    house,
    assetsPresent,
    complete: ARENA_ASSETS.every((a) => assetsPresent.includes(a)),
    predictions: preds.map((p) => ({
      asset: p.asset,
      price: p.price,
      submittedAt: p.submittedAt,
      updatedAt: p.updatedAt,
    })),
  };
  const out = decorateWithPrizeEligibility(payload, {
    wallet: w,
    botName: displayName,
    roundId: meta.roundId,
    baseUrl,
    req,
  });
  out.referral = getReferralView(w, { arenaStore: store });
  return out;
}

export function submitPrediction(body) {
  const store = getStore();
  const roundId = String(body.roundId || "").trim();
  if (!roundId) {
    throw Object.assign(new Error("roundId required"), { code: "missing_round", status: 400 });
  }
  let meta;
  try {
    meta = parseRoundId(roundId);
  } catch {
    throw Object.assign(new Error("invalid roundId"), { code: "invalid_round", status: 400 });
  }
  store.ensureRound(meta);
  const lifecycle = roundStatusAt(meta);
  // Persist accurate lifecycle so locked/closed rounds are not left marked "open".
  if (lifecycle === "locked" || lifecycle === "closed") {
    const round = store.getRound(meta.roundId);
    if (round && round.status !== "scored") store.setRoundStatus(meta.roundId, "locked");
  }
  if (lifecycle !== "open") {
    throw Object.assign(
      new Error(`round is ${lifecycle}; entries only accepted while open (before cutoff)`),
      { code: "round_not_open", status: 403, lifecycle, cutoffAt: meta.cutoffAt },
    );
  }

  let verified;
  try {
    verified = verifyPredictionSignature({
      roundId,
      wallet: body.wallet,
      asset: body.asset,
      price: body.price,
      botName: body.botName,
      signature: body.signature,
    });
  } catch (err) {
    throw Object.assign(new Error(err.message), {
      code: err.code || "verify_failed",
      status: 400,
    });
  }

  // Reserve official-* names for configured house wallets only.
  if (isReservedHouseName(verified.botName) && !isHouseWallet(verified.wallet)) {
    throw Object.assign(
      new Error("botName prefix official- is reserved for Crypto Pulse house bots"),
      { code: "reserved_bot_name", status: 403 },
    );
  }

  const firstEntry = !walletHasPrediction(store, verified.wallet);
  const ref = String(body.ref || "").trim();
  if (firstEntry && ref) {
    bindReferral({
      referred: verified.wallet,
      referrer: ref,
      botName: verified.botName,
      arenaStore: store,
    });
  }

  const house = isHouseEntrant({ wallet: verified.wallet, botName: verified.botName });
  const pulse = pulseQualification({ wallet: verified.wallet, roundId });
  const prizeEligible = !house && pulse.qualified;
  let ineligibleReason = null;
  if (house) ineligibleReason = "house bot";
  else if (pulse.applies && !pulse.qualified) ineligibleReason = NO_PULSE_REASON;
  const { created, prediction } = store.upsertPrediction(roundId, {
    wallet: verified.wallet,
    botName: verified.botName,
    asset: verified.asset,
    price: verified.price,
    priceCanonical: verified.priceCanonical,
    message: verified.message,
    signature: verified.signature,
    house,
  });

  refreshReferralProgress({ wallet: prediction.wallet, arenaStore: store });
  const referral = getReferralView(prediction.wallet, { arenaStore: store });

  return decorateWithPrizeEligibility(
    {
      ok: true,
      created,
      updated: !created,
      roundId,
      cutoffAt: meta.cutoffAt,
      closeAt: meta.closeAt,
      referral,
      prediction: {
        wallet: prediction.wallet,
        botName: prediction.botName,
        asset: prediction.asset,
        price: prediction.price,
        house: Boolean(prediction.house || house),
        pulseQualified: pulse.qualified,
        prizeEligible,
        eligible: prizeEligible,
        ineligibleReason,
        submittedAt: prediction.submittedAt,
        updatedAt: prediction.updatedAt,
      },
    },
    { wallet: prediction.wallet, botName: prediction.botName, roundId },
  );
}

export function exportWinners({ roundId, weekId } = {}) {
  const store = getStore();
  const payoutNote = autopayEnabled()
    ? "Automatic on-chain USDC payouts from the public prize wallet while funded and within the program window. Insufficient balance is recorded as unpaid/owed. Kill switch: ARENA_AUTOPAY=off."
    : "Autopay is disabled (ARENA_AUTOPAY=off). Eligible prizes are recorded as unpaid until re-enabled or paid manually.";

  const daily = [];
  const roundIds = store.listRoundIds().sort();
  for (const id of roundIds) {
    const board = getLeaderboard(id);
    const winner = board.prizeWinner || board.ranking.find((r) => r.prizeEligible) || null;
    const payout = store.getPayout("daily", id);
    daily.push({
      type: "daily",
      roundId: id,
      status: board.status,
      scoredAt: board.scoredAt,
      amountUsdc: payout.amountUsdc ?? DAILY_PRIZE_USDC,
      wallet: payout.wallet || winner?.wallet || null,
      botName: payout.botName || winner?.botName || null,
      score: payout.score ?? winner?.avgAbsPctError ?? null,
      paid: Boolean(payout.paid || payout.status === "paid"),
      payoutStatus: payout.status || (payout.paid ? "paid" : "unpaid"),
      paidAt: payout.paidAt,
      pendingAt: payout.pendingAt || null,
      txSignature: payout.txSignature || null,
      explorer: payout.explorer || null,
      paidUtcDay: payout.paidUtcDay || null,
      error: payout.error || null,
      note: payout.note,
      eligible: Boolean(winner) && board.status === "scored",
    });
  }

  const weeks = new Set([FIRST_WEEK_START, currentWeekId()]);
  for (const id of roundIds) {
    try {
      weeks.add(weekIdFromRoundId(id));
    } catch {
      /* ignore */
    }
  }
  for (const wid of Object.keys(store.listPayouts().weekly || {})) weeks.add(wid);
  if (weekId) weeks.add(weekId);

  const weekly = [];
  for (const wid of [...weeks].sort()) {
    if (wid < FIRST_WEEK_START) continue;
    const board = getWeeklyLeaderboard(wid);
    const winner = board.winner;
    const payout = store.getPayout("weekly", wid);
    weekly.push({
      type: "weekly",
      weekId: wid,
      startRoundId: board.startRoundId,
      endRoundId: board.endRoundId,
      amountUsdc: payout.amountUsdc ?? WEEKLY_PRIZE_USDC,
      wallet: payout.wallet || winner?.wallet || null,
      botName: payout.botName || winner?.botName || null,
      score: payout.score ?? winner?.avgAbsPctError ?? null,
      roundsEntered: winner?.roundsEntered ?? 0,
      paid: Boolean(payout.paid || payout.status === "paid"),
      payoutStatus: payout.status || (payout.paid ? "paid" : "unpaid"),
      paidAt: payout.paidAt,
      pendingAt: payout.pendingAt || null,
      txSignature: payout.txSignature || null,
      explorer: payout.explorer || null,
      paidUtcDay: payout.paidUtcDay || null,
      error: payout.error || null,
      note: payout.note,
      eligible: Boolean(winner) && winner.avgAbsPctError != null,
    });
  }

  const dailyOut = roundId ? daily.filter((d) => d.roundId === roundId) : daily;
  const weeklyOut = weekId ? weekly.filter((w) => w.weekId === weekId) : weekly;
  return {
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    prizes: prizeSummary(),
    payoutNote,
    daily: dailyOut,
    weekly: weeklyOut,
    owedUnpaid: [...dailyOut, ...weeklyOut].filter(
      (x) => x.eligible && !x.paid && x.payoutStatus !== "skipped" && x.payoutStatus !== "outside_window",
    ),
    prizeWallet: resolvePrizeWalletAddress(),
    autopayEnabled: autopayEnabled(),
    referrals: referralAdminSummary({ arenaStore: store }),
  };
}

export async function getPrizeStatus() {
  const store = getStore();
  const wallet = await getPrizeWalletPublicStatus();
  return {
    autopayEnabled: autopayEnabled(),
    wallet,
    recentPayouts: listPublicPayoutHistory(store, { limit: 40 }),
  };
}

export function setPayoutAdmin({ type, id, paid, note }) {
  const store = getStore();
  if (type !== "daily" && type !== "weekly") {
    throw Object.assign(new Error("type must be daily or weekly"), { code: "invalid_type", status: 400 });
  }
  if (!id) {
    throw Object.assign(new Error("id required (roundId or weekId)"), { code: "missing_id", status: 400 });
  }
  if (typeof paid !== "boolean") {
    throw Object.assign(new Error("paid must be boolean"), { code: "invalid_paid", status: 400 });
  }
  const row = store.setPayout(type, id, { paid, note });
  return { ok: true, type, id, ...row };
}

export function deletePredictionAdmin({ roundId, wallet, asset }) {
  const store = getStore();
  return store.deletePrediction(roundId, wallet, asset || null);
}

export function deleteReferralAdmin({ wallet }) {
  const w = String(wallet || "").trim();
  if (!w) {
    throw Object.assign(new Error("wallet required"), { code: "missing_wallet", status: 400 });
  }
  const deleted = getReferralStore().deleteBinding(w);
  return { ok: true, deleted, wallet: w };
}

export { getReferrerDashboard, getReferralView, processReferralPayouts };

export async function runDueScoring() {
  const store = getStore();
  // Only score rounds that already exist in the store (created when someone entered
  // or when the current round was described). Skip empty historical ids so we do
  // not hammer CoinGecko on every process start.
  const known = new Set(store.listRoundIds());
  const ids = [...known].filter((id) => {
    try {
      const meta = parseRoundId(id);
      return Date.now() >= new Date(meta.closeAt).getTime();
    } catch {
      return false;
    }
  });
  const results = [];
  for (const id of ids) {
    const round = store.getRound(id);
    if (!round) continue;
    if (round.status === "scored") {
      results.push({ roundId: id, skipped: true });
      continue;
    }
    if (!round.predictions.length) {
      store.setRoundStatus(id, "scored");
      results.push({ roundId: id, ok: true, empty: true });
      continue;
    }
    try {
      const r = await scoreRound(store, id);
      results.push(r);
    } catch (err) {
      results.push({ roundId: id, ok: false, error: String(err?.message || err) });
      console.error(
        JSON.stringify({ event: "arena_score_error", roundId: id, error: String(err?.message || err) }),
      );
    }
  }
  let autopay = null;
  try {
    autopay = await processAutopay(store);
  } catch (err) {
    autopay = { ok: false, error: String(err?.message || err) };
    console.error(JSON.stringify({ event: "arena_autopay_tick_error", error: String(err?.message || err) }));
  }
  let referrals = null;
  try {
    referrals = await processReferralPayouts(store);
    if (referrals?.results?.length) {
      console.log(
        JSON.stringify({
          event: "arena_referral_tick",
          mode: referrals.mode,
          prizeReserveUsdc: referrals.prizeReserveUsdc,
          spentTodayUsdc: referrals.spentTodayUsdc,
          results: referrals.results.length,
        }),
      );
    }
  } catch (err) {
    referrals = { ok: false, error: String(err?.message || err) };
    console.error(JSON.stringify({ event: "arena_referral_tick_error", error: String(err?.message || err) }));
  }
  return { scoring: results, autopay, referrals };
}

export function startArenaScorer({ intervalMs = 60_000 } = {}) {
  if (scorerTimer) return;
  const tick = () => {
    runDueScoring().catch((err) => {
      console.error(JSON.stringify({ event: "arena_scorer_tick_error", error: String(err?.message || err) }));
    });
  };
  tick();
  scorerTimer = setInterval(tick, intervalMs);
  if (typeof scorerTimer.unref === "function") scorerTimer.unref();
  console.log(JSON.stringify({ event: "arena_scorer_started", intervalMs }));
  startHouseBotScheduler({
    submitPrediction,
    getStore,
  });
}

export function stopArenaScorer() {
  if (scorerTimer) {
    clearInterval(scorerTimer);
    scorerTimer = null;
  }
}


/**
 * Full public results for a round: closes, every prediction with score, winner, payout.
 */
export function getRoundResults(roundId) {
  const store = getStore();
  const meta = parseRoundId(roundId || currentEntryRound().roundId);
  store.ensureRound(meta);
  const round = store.getRound(meta.roundId);
  const board = getLeaderboard(meta.roundId);
  const payout = store.getPayout("daily", meta.roundId);
  const predictions = (round.predictions || []).map((p) => {
    const house = Boolean(p.house) || isHouseEntrant({ wallet: p.wallet, botName: p.botName });
    const pulse = pulseQualification({ wallet: p.wallet, roundId: meta.roundId });
    const prizeEligible = !house && pulse.qualified;
    let ineligibleReason = null;
    if (house) ineligibleReason = "house bot";
    else if (pulse.applies && !pulse.qualified) ineligibleReason = NO_PULSE_REASON;
    return {
      wallet: p.wallet,
      botName: p.botName,
      asset: p.asset,
      price: p.price,
      absPctError: p.absPctError,
      submittedAt: p.submittedAt,
      updatedAt: p.updatedAt,
      house,
      pulseQualified: pulse.qualified,
      prizeEligible,
      eligible: prizeEligible,
      ineligibleReason,
    };
  });
  const winner = board.prizeWinner || null;
  return {
    roundId: meta.roundId,
    openAt: meta.openAt,
    cutoffAt: meta.cutoffAt,
    closeAt: meta.closeAt,
    status: round.status,
    closes: round.closes,
    scoredAt: round.scoredAt,
    source: round.closes?.source || null,
    predictions,
    ranking: board.ranking,
    incomplete: board.incomplete,
    prizeWinner: winner,
    displayLeader: board.ranking[0] || null,
    payout: {
      amountUsdc: payout.amountUsdc ?? DAILY_PRIZE_USDC,
      wallet: payout.wallet || winner?.wallet || null,
      botName: payout.botName || winner?.botName || null,
      paid: Boolean(payout.paid || payout.status === "paid"),
      payoutStatus: payout.status || (payout.paid ? "paid" : "unpaid"),
      paidAt: payout.paidAt || null,
      txSignature: payout.txSignature || null,
      explorer: payout.explorer || null,
      note: payout.note || null,
      error: payout.error || null,
    },
    houseBots: listHouseWalletsPublic(),
    houseBotsNote:
      "official-* house bots are shown for transparency and are never prize-eligible or autopaid.",
  };
}

/**
 * Rate-limited public history of rounds / predictions / results.
 */
export function getArenaHistory({ limit = 30, includePredictions = true } = {}) {
  const store = getStore();
  const ids = store.listRoundIds().sort().reverse().slice(0, Math.min(100, Math.max(1, Number(limit) || 30)));
  const rounds = ids.map((id) => {
    const r = getRoundResults(id);
    if (!includePredictions) {
      const { predictions, ...rest } = r;
      return { ...rest, predictionCount: (predictions || []).length };
    }
    return r;
  });
  return {
    count: rounds.length,
    houseBots: listHouseWalletsPublic(),
    rounds,
  };
}

export function arenaHistoryToCsv(history) {
  const lines = [
    "roundId,status,scoredAt,asset,wallet,botName,house,eligible,predicted,actual,absPctError,prizeWinnerWallet,payoutStatus,txSignature,explorer",
  ];
  for (const round of history.rounds || []) {
    const closes = round.closes || {};
    const win = round.prizeWinner?.wallet || "";
    const pay = round.payout || {};
    const preds = round.predictions || [];
    if (!preds.length) {
      lines.push(
        [
          round.roundId,
          round.status,
          round.scoredAt || "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          win,
          pay.payoutStatus || "",
          pay.txSignature || "",
          pay.explorer || "",
        ].join(","),
      );
      continue;
    }
    for (const p of preds) {
      lines.push(
        [
          round.roundId,
          round.status,
          round.scoredAt || "",
          p.asset,
          p.wallet,
          JSON.stringify(p.botName || ""),
          Boolean(p.house),
          Boolean(p.eligible),
          p.price ?? "",
          closes[p.asset] ?? "",
          p.absPctError ?? "",
          win,
          pay.payoutStatus || "",
          pay.txSignature || "",
          pay.explorer || "",
        ].join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

export async function triggerHouseBotEntries() {
  return runHouseBotEntries({ submitPrediction, getStore });
}

// Re-exports useful for scripts/MCP
export {
  ARENA_ASSETS,
  buildCanonicalMessage,
  normalizePrice,
  normalizeAsset,
  sanitizeBotName,
  verifyPredictionSignature,
  parseRoundId,
  currentEntryRound,
  processAutopay,
  listPublicPayoutHistory,
  autopayEnabled,
  getPrizeWalletPublicStatus,
  resolvePrizeWalletAddress,
  HOUSE_BOT_DEFS,
  listHouseWalletsPublic,
  isHouseEntrant,
  houseBotsEnabled,
  ensureHouseWalletsFile,
};
