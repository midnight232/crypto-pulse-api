/**
 * Daily UTC round timing for Crypto Pulse Prediction Arena.
 *
 * Round ID = UTC date of settlement midnight (YYYY-MM-DD).
 * closeAt  = that midnight (price we predict)
 * cutoffAt = closeAt − 12h  (no more entries)
 * openAt   = closeAt − 36h  (previous cutoff — always an open target after noon)
 *
 * Free entry. No stakes. Sponsor-funded prizes paid automatically on-chain while funded.
 */

import { prizePoolLabel, prizePoolShort, prizeSummary, weekBounds } from "./prizes.js";
import { describePulseEligibilityRule } from "../pulse-usage.js";

/** Assets for rounds through the week of 2026-11-09 (last round 2026-11-15). */
export const ARENA_ASSETS_LEGACY = ["BTC", "ETH", "SOL"];
/** Assets starting with the first round of the next weekly (2026-11-16). */
export const ARENA_ASSETS_V2 = ["BTC", "SOL", "SUI", "HYPE", "ZEC"];
/** Week whose last round is the last BTC/ETH/SOL round. */
export const ARENA_ASSETS_CHANGE_AFTER_WEEK = "2026-11-09";
export const ARENA_COINGECKO_IDS = Object.freeze({
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  SUI: "sui",
  HYPE: "hyperliquid",
  ZEC: "zcash",
});

/**
 * @deprecated Prefer arenaAssetsForRound(roundId). Alias of the legacy set so
 * older call sites that only touch pre-2026-11-16 rounds keep compiling.
 */
export const ARENA_ASSETS = ARENA_ASSETS_LEGACY;

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

function addUtcDays(roundId, days) {
  const d = new Date(`${roundId}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatRoundId(d);
}

/** First round id of the weekly after ARENA_ASSETS_CHANGE_AFTER_WEEK (2026-11-16). */
export const ARENA_ASSETS_V2_FIRST_ROUND = addUtcDays(
  weekBounds(ARENA_ASSETS_CHANGE_AFTER_WEEK).endRoundId,
  1,
);

export function arenaAssetsForRound(roundId) {
  const id = String(roundId || "").trim();
  if (id && id >= ARENA_ASSETS_V2_FIRST_ROUND) return ARENA_ASSETS_V2.slice();
  return ARENA_ASSETS_LEGACY.slice();
}

export function coingeckoIdsForAssets(assets) {
  return assets.map((a) => {
    const id = ARENA_COINGECKO_IDS[a];
    if (!id) throw new Error(`no_coingecko_id_${a}`);
    return id;
  });
}

export function describeArenaAssetSchedule() {
  const week = weekBounds(ARENA_ASSETS_CHANGE_AFTER_WEEK);
  const firstMeta = parseRoundId(ARENA_ASSETS_V2_FIRST_ROUND);
  const lastLegacy = week.endRoundId;
  const lastMeta = parseRoundId(lastLegacy);
  return {
    throughRoundId: lastLegacy,
    throughWeekId: week.weekId,
    throughCloseAt: lastMeta.closeAt,
    legacyAssets: ARENA_ASSETS_LEGACY.slice(),
    firstNewRoundId: ARENA_ASSETS_V2_FIRST_ROUND,
    firstNewRoundCloseAt: firstMeta.closeAt,
    newAssets: ARENA_ASSETS_V2.slice(),
    coingeckoIds: { ...ARENA_COINGECKO_IDS },
    fundedDailyNote:
      "The last funded daily prize round is 2026-11-16 and uses the new BTC, SOL, SUI, HYPE, ZEC set. The funded weekly (2026-11-09 through 2026-11-15) stays on BTC, ETH, and SOL. The next weekly (week id 2026-11-16) uses the new set.",
    text:
      `Through the week of ${week.weekId} (rounds ${week.startRoundId} through ${week.endRoundId}, last close ${lastMeta.closeAt}), assets are BTC, ETH, and SOL. ` +
      `Starting with round ${ARENA_ASSETS_V2_FIRST_ROUND} (closes ${firstMeta.closeAt} / 6:00 PM CT on 15 Nov 2026), assets are BTC, SOL, SUI, HYPE, and ZEC ` +
      `(CoinGecko ids sui, hyperliquid, and zcash). Already-scored rounds are unchanged. Ranking requires every asset in that round's set. ` +
      `The last funded daily prize (2026-11-16) uses the new set.`,
  };
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
    assets: arenaAssetsForRound(currentEntryRound().roundId),
    assetSchedule: describeArenaAssetSchedule(),
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
      rankBy: "average abs % error across that round's asset set (lower is better). Through 2026-11-15: BTC, ETH, SOL. From 2026-11-16: BTC, SOL, SUI, HYPE, ZEC.",
      tieBreak: "earliest first submission timestamp among the wallet's assets in that round",
    },
    prizes: {
      funding: "Sponsor-funded by the operator (Matt). Not funded by entrants.",
      payout:
        "Automatic on-chain USDC from the public prize wallet after scoring, while the funded program is active. Caps: max $10 per payout, max $11 USDC total per UTC day. Insufficient balance → unpaid/owed (not dropped). Kill switch ARENA_AUTOPAY=off. House bots (official-*) are never eligible. Starting with the round that closes 00:00 UTC on 2026-11-13, a bot is prize-eligible for a daily round only if it made at least one GET /v1/pulse call during the UTC day that ends at closeAt (the previous UTC calendar date). Send X-Pulse-Client-Id equal to the payout wallet (the same Solana address used as wallet on predict); a paid call also counts when the payer wallet matches. Weekly prize: the bot must have been prize-eligible under this rule on at least one applicable day of the week (for 2026-11-09–15, only 2026-11-13..15). Ineligible bots are still scored and shown. If there is no prize-eligible entry, no prize.",
      pulseEligibility: describePulseEligibilityRule(),
      amount: prizePoolLabel(),
      short: prizePoolShort(),
      details: prizeSummary(),
      discretion:
        "Sponsor may delay, adjust, or withhold a prize for suspected multi-wallet farming or rule abuse. Void where prohibited.",
    },
    antiSybil:
      "One serious entry per operator. Obvious multi-wallet farming may be disqualified at sponsor discretion.",
    houseBots: {
      names: ["official-baseline", "official-momentum", "official-meanrevert"],
      disclosure:
        "These are operator-run house bots. They enter daily rounds automatically, appear on leaderboards with house:true, and are never prize-eligible or autopaid. The next prize-eligible bot receives any prize instead.",
      reservedPrefix: "official-",
    },
    disclaimer:
      "Skill contest for bots. Free to enter. No purchase necessary. Not gambling. Market data is not financial advice. Void where prohibited.",
  };
}
