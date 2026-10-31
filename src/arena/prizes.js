/**
 * Sponsor prize amounts and weekly windows for the Prediction Arena.
 * Manual USDC payouts only — the server never sends funds.
 */

/** Daily #1 prize in USDC (informational; paid manually). */
export const DAILY_PRIZE_USDC = 1;
/** Weekly winner prize in USDC (informational; paid manually). */
export const WEEKLY_PRIZE_USDC = 10;
/** Minimum distinct daily rounds (complete BTC+ETH+SOL) required in a week. */
export const WEEKLY_MIN_ROUNDS = 5;
/**
 * First prize week (Monday UTC round id). Covers Nov 2–Nov 8 2026.
 * Later weeks follow the same Monday–Sunday UTC calendar by round id.
 */
export const FIRST_WEEK_START = "2026-11-02";

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Monday UTC date containing the given instant or YYYY-MM-DD. */
export function mondayUtcOf(input = new Date()) {
  const d =
    typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? new Date(`${input}T00:00:00.000Z`)
      : new Date(input);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

export function weekIdFromRoundId(roundId) {
  return formatDay(mondayUtcOf(roundId));
}

export function weekBounds(weekId) {
  const start = mondayUtcOf(weekId || FIRST_WEEK_START);
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(formatDay(new Date(start.getTime() + i * 24 * 3600_000)));
  }
  return {
    weekId: days[0],
    startRoundId: days[0],
    endRoundId: days[6],
    roundIds: days,
    label: `${days[0]} through ${days[6]} (Monday–Sunday UTC by round id)`,
  };
}

/** Current prize week: Monday of today UTC, not before FIRST_WEEK_START. */
export function currentWeekId(now = new Date()) {
  let wid = weekIdFromRoundId(formatDay(now));
  if (wid < FIRST_WEEK_START) wid = FIRST_WEEK_START;
  return wid;
}

export function prizeSummary() {
  const first = weekBounds(FIRST_WEEK_START);
  return {
    daily: {
      amountUsdc: DAILY_PRIZE_USDC,
      text: `Daily prize: $${DAILY_PRIZE_USDC} USDC to the #1 bot of each daily round.`,
    },
    weekly: {
      amountUsdc: WEEKLY_PRIZE_USDC,
      minRounds: WEEKLY_MIN_ROUNDS,
      weekDefinition:
        "A week is Monday through Sunday UTC by round id (settlement date). Week id is the Monday date.",
      firstWeek: first,
      text:
        `Weekly prize: $${WEEKLY_PRIZE_USDC} USDC to the bot with the best average daily score over the week ` +
        `(Monday–Sunday UTC by round id) who entered at least ${WEEKLY_MIN_ROUNDS} of that week's 7 daily rounds. ` +
        `The first weekly period is ${first.startRoundId} through ${first.endRoundId}. ` +
        `Later weeks follow the same Monday–Sunday UTC calendar.`,
    },
    payout:
      "Both prizes are paid manually by the sponsor in USDC on Solana to the winning wallet after review, usually within a few days of the period ending. The server never sends funds. If there is no eligible entry, no prize.",
    shortLabel: `Daily $${DAILY_PRIZE_USDC} USDC · Weekly $${WEEKLY_PRIZE_USDC} USDC (min ${WEEKLY_MIN_ROUNDS}/7 rounds)`,
  };
}

/** Full prize rules text (default when ARENA_PRIZE_POOL unset). */
export function prizePoolLabel() {
  const override = (process.env.ARENA_PRIZE_POOL || "").trim();
  if (override) return `Prize pool: ${override}`;
  const p = prizeSummary();
  return `${p.daily.text} ${p.weekly.text} ${p.payout}`;
}

export function prizePoolShort() {
  const override = (process.env.ARENA_PRIZE_POOL || "").trim();
  if (override) return override;
  return prizeSummary().shortLabel;
}
