/**
 * Sponsor prize amounts and weekly windows for the Prediction Arena.
 * Automatic USDC payouts from the public prize wallet while funded (ARENA_AUTOPAY).
 */

/** Daily #1 prize in USDC (paid automatically on-chain while funded). */
export const DAILY_PRIZE_USDC = 1;
/** Weekly winner prize in USDC (paid automatically on-chain while funded). */
export const WEEKLY_PRIZE_USDC = 10;
/** Minimum distinct daily rounds (complete for that day's asset set) required in a week. */
export const WEEKLY_MIN_ROUNDS = 5;
/**
 * First prize week (Monday UTC round id). Covers Nov 2–Nov 8 2026.
 * Later weeks follow the same Monday–Sunday UTC calendar by round id.
 */
export const FIRST_WEEK_START = "2026-11-02";
/** Daily rounds eligible for automatic prize payouts (inclusive, by round id). */
export const AUTOPAY_DAILY_START = "2026-11-03";
export const AUTOPAY_DAILY_END = "2026-11-23";
/** Weekly week ids (Monday UTC by round id) covered by the funded program. */
export const AUTOPAY_WEEK_IDS = Object.freeze(["2026-11-02", "2026-11-09", "2026-11-16"]);

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
  const weeklyLabels = AUTOPAY_WEEK_IDS.map((id) => {
    const b = weekBounds(id);
    return `${b.startRoundId}–${b.endRoundId.slice(8)}`;
  });
  const weeklyList =
    weeklyLabels.length <= 2
      ? weeklyLabels.join(" and ")
      : `${weeklyLabels.slice(0, -1).join(", ")}, and ${weeklyLabels[weeklyLabels.length - 1]}`;
  return {
    daily: {
      amountUsdc: DAILY_PRIZE_USDC,
      text: `Daily prize: $${DAILY_PRIZE_USDC} USDC to the #1 prize-eligible bot of each daily round (from the 2026-11-13 close onward, eligibility requires at least one GET /v1/pulse call on the qualifying UTC day, with X-Pulse-Client-Id or payer wallet equal to the payout wallet).`,
    },
    weekly: {
      amountUsdc: WEEKLY_PRIZE_USDC,
      minRounds: WEEKLY_MIN_ROUNDS,
      weekDefinition:
        "A week is Monday through Sunday UTC by round id (settlement date). Week id is the Monday date.",
      firstWeek: first,
      text:
        `Weekly prize: $${WEEKLY_PRIZE_USDC} USDC to the bot with the best average daily score over the week ` +
        `(Monday–Sunday UTC by round id) who entered at least ${WEEKLY_MIN_ROUNDS} of that week's 7 daily rounds ` +
        `and was prize-eligible under the /v1/pulse rule on at least one applicable day of that week ` +
        `(for 2026-11-09–15, only rounds 2026-11-13..15 count toward that pulse requirement). ` +
        `The first weekly period is ${first.startRoundId} through ${first.endRoundId}. ` +
        `Later weeks follow the same Monday–Sunday UTC calendar.`,
    },
    payout:
      `Both prizes are paid automatically on-chain in USDC on Solana from the public prize wallet after the round/week is scored, while the funded program is active (daily rounds ${AUTOPAY_DAILY_START} through ${AUTOPAY_DAILY_END}; weekly contests ${weeklyList}). If the prize wallet balance is insufficient, the prize is recorded as unpaid/owed until funded. Kill switch: ARENA_AUTOPAY=off. House bots never win. Ineligible bots (including those with no /v1/pulse call on an enforced day) are still scored and shown. If there is no eligible entry, no prize.`,
    shortLabel: `Daily ${DAILY_PRIZE_USDC} USDC · Weekly ${WEEKLY_PRIZE_USDC} USDC (min ${WEEKLY_MIN_ROUNDS}/7 rounds)`,
    autopayProgram: {
      dailyRounds: { start: AUTOPAY_DAILY_START, end: AUTOPAY_DAILY_END },
      weeklyWeekIds: [...AUTOPAY_WEEK_IDS],
      maxSingleUsdc: 10,
      maxPerUtcDayUsdc: 11,
    },
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
