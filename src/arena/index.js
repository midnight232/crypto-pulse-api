/**
 * Crypto Pulse Prediction Arena — public API used by HTTP + MCP.
 * Free entry. Manual sponsor payouts only. No automatic transfers.
 */
import { ArenaStore } from "./store.js";
import {
  ARENA_ASSETS,
  arenaRules,
  currentEntryRound,
  parseRoundId,
  prizePoolLabel,
  recentClosableRoundIds,
  roundStatusAt,
} from "./rounds.js";
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
    ranking: rows,
    incomplete,
  };
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

export function exportWinners(roundId) {
  const board = getLeaderboard(roundId);
  const winner = board.ranking[0] || null;
  return {
    roundId: board.roundId,
    status: board.status,
    closes: board.closes,
    scoredAt: board.scoredAt,
    prize: prizePoolLabel(),
    payoutNote:
      "Manual payout only after sponsor approval. This export is informational — the server cannot send funds.",
    winner,
    ranking: board.ranking,
  };
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
  return results;
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
};
