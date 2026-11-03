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
  return arenaRules();
}

export function getLeaderboard(roundId) {
  const store = getStore();
  const meta = parseRoundId(roundId || currentEntryRound().roundId);
  store.ensureRound(meta);
  const round = store.getRound(meta.roundId);
  const { rows, incomplete } = buildLeaderboard(round);
  return {
    roundId: meta.roundId,
    status: round.status,
    closes: round.closes,
    scoredAt: round.scoredAt,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    dailyPrizeUsdc: DAILY_PRIZE_USDC,
    ranking: rows,
    incomplete,
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

  const { created, prediction } = store.upsertPrediction(roundId, {
    wallet: verified.wallet,
    botName: verified.botName,
    asset: verified.asset,
    price: verified.price,
    priceCanonical: verified.priceCanonical,
    message: verified.message,
    signature: verified.signature,
  });

  return {
    ok: true,
    created,
    updated: !created,
    roundId,
    cutoffAt: meta.cutoffAt,
    closeAt: meta.closeAt,
    prediction: {
      wallet: prediction.wallet,
      botName: prediction.botName,
      asset: prediction.asset,
      price: prediction.price,
      submittedAt: prediction.submittedAt,
      updatedAt: prediction.updatedAt,
    },
  };
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
    const winner = board.ranking[0] || null;
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
  return { scoring: results, autopay };
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
}

export function stopArenaScorer() {
  if (scorerTimer) {
    clearInterval(scorerTimer);
    scorerTimer = null;
  }
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
};
