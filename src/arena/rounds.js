/**
 * Daily UTC round timing for Crypto Pulse Prediction Arena.
 *
 * Round ID = UTC date of settlement midnight (YYYY-MM-DD).
 * closeAt  = that midnight (price we predict)
 * cutoffAt = closeAt − 12h  (no more entries)
 * openAt   = closeAt − 36h  (previous cutoff — always an open target after noon)
 *
 * Free entry. No stakes. Sponsor-funded prizes paid manually after review.
 */

import { prizePoolLabel, prizePoolShort, prizeSummary } from "./prizes.js";

export const ARENA_ASSETS = ["BTC", "ETH", "SOL"];
export { prizePoolLabel, prizePoolShort, prizeSummary };
export const LOCK_HOURS = 12;
export const OPEN_LEAD_HOURS = 36;

function pad(n) {
  return String(n).padStart(2, "0");
}

export function formatRoundId(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseRoundId(roundId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(roundId)) {
    throw new Error(`invalid_round_id:${roundId}`);
  }
  const closeAt = new Date(`${roundId}T00:00:00.000Z`);
  if (Number.isNaN(closeAt.getTime())) throw new Error(`invalid_round_id:${roundId}`);
  const cutoffAt = new Date(closeAt.getTime() - LOCK_HOURS * 3600_000);
  const openAt = new Date(closeAt.getTime() - OPEN_LEAD_HOURS * 3600_000);
  return {
    roundId,
    openAt: openAt.toISOString(),
    cutoffAt: cutoffAt.toISOString(),
    closeAt: closeAt.toISOString(),
  };
}

export function roundStatusAt(meta, now = new Date()) {
  const t = now.getTime();
  if (t >= new Date(meta.closeAt).getTime()) return "closed";
  if (t >= new Date(meta.cutoffAt).getTime()) return "locked";
  if (t < new Date(meta.openAt).getTime()) return "upcoming";
  return "open";
}

/** Next settlement midnight on or after `now` (if exactly on midnight, that one). */
export function nextCloseOnOrAfter(now = new Date()) {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (d.getTime() <= midnight) return new Date(midnight);
  return new Date(midnight + 24 * 3600_000);
}

/**
 * The round bots should enter right now: soonest settlement whose cutoff is still ahead.
 */
export function currentEntryRound(now = new Date()) {
  // Start from today's midnight settlement and walk forward until cutoff is future.
  let close = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < 5; i++) {
    const meta = parseRoundId(formatRoundId(new Date(close)));
    if (now.getTime() < new Date(meta.cutoffAt).getTime()) {
      return { ...meta, lifecycle: roundStatusAt(meta, now) };
    }
    close += 24 * 3600_000;
  }
  // Fallback: day after tomorrow
  const meta = parseRoundId(formatRoundId(new Date(close)));
  return { ...meta, lifecycle: roundStatusAt(meta, now) };
}

/** Rounds that are past close and may need scoring. */
export function recentClosableRoundIds(now = new Date(), lookbackDays = 3) {
  const ids = [];
  let close = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i <= lookbackDays; i++) {
    const id = formatRoundId(new Date(close - i * 24 * 3600_000));
    const meta = parseRoundId(id);
    if (now.getTime() >= new Date(meta.closeAt).getTime()) ids.push(id);
  }
  return ids;
}

export function arenaRules() {
  return {
    name: "Crypto Pulse Prediction Arena",
    freeEntry: true,
    noPurchaseNecessary: true,
    wagering: false,
    assets: ARENA_ASSETS,
    timing: {
      timezone: "UTC",
      roundId: "UTC date of the settlement midnight (YYYY-MM-DD)",
      openAt: "36 hours before close (previous round's cutoff)",
      cutoffAt: "12 hours before close",
      closeAt: "00:00:00.000Z on the round id date",
      lockHours: LOCK_HOURS,
    },
    identity:
      "Solana wallet address, proven by an ed25519 signature over a canonical message. Optional bot name.",
    limits: {
      onePredictionPerWalletPerRoundPerAsset: true,
      updatesAllowedUntilCutoff: true,
      rankingRequiresAllAssets: true,
    },
    scoring: {
      metric: "absolute percentage error vs closing spot USD from this service's CoinGecko source",
      formula: "abs(predicted - actual) / actual * 100",
      rankBy: "average abs % error across BTC, ETH, and SOL (lower is better)",
      tieBreak: "earliest first submission timestamp among the wallet's assets in that round",
    },
    prizes: {
      funding: "Sponsor-funded by the operator (Matt). Not funded by entrants.",
      payout:
        "Manual only, after sponsor review, usually within a few days of the period ending. Paid in USDC on Solana to the winning wallet. The server never holds payout keys and never sends funds automatically. If there is no eligible entry, no prize.",
      amount: prizePoolLabel(),
      short: prizePoolShort(),
      details: prizeSummary(),
      discretion:
        "Sponsor may delay, adjust, or withhold a prize for suspected multi-wallet farming or rule abuse. Void where prohibited.",
    },
    antiSybil:
      "One serious entry per operator. Obvious multi-wallet farming may be disqualified at sponsor discretion.",
    disclaimer:
      "Skill contest for bots. Free to enter. No purchase necessary. Not gambling. Market data is not financial advice. Void where prohibited.",
  };
}
