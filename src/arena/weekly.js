/**
 * Weekly arena leaderboard helpers.
 */
import { buildLeaderboard } from "./scoring.js";
import { isHouseEntrant } from "./house.js";
import { NO_PULSE_REASON, pulseRuleApplies } from "../pulse-usage.js";
import {
  WEEKLY_MIN_ROUNDS,
  WEEKLY_PRIZE_USDC,
  currentWeekId,
  prizePoolLabel,
  prizePoolShort,
  weekBounds,
} from "./prizes.js";

/**
 * @param {import('./store.js').ArenaStore} store
 * @param {string} [weekId] Monday YYYY-MM-DD
 */
export function buildWeeklyLeaderboard(store, weekId) {
  const wid = weekId || currentWeekId();
  const bounds = weekBounds(wid);
  const byWallet = new Map();

  for (const roundId of bounds.roundIds) {
    const round = store.getRound(roundId);
    if (!round) continue;
    const { rows } = buildLeaderboard(round);
    for (const row of rows) {
      const house = row.house || isHouseEntrant({ wallet: row.wallet, botName: row.botName });
      if (!byWallet.has(row.wallet)) {
        byWallet.set(row.wallet, {
          wallet: row.wallet,
          botName: row.botName || null,
          house,
          roundsEntered: [],
          scoredErrors: [],
          pulseQualifiedRoundIds: [],
        });
      }
      const w = byWallet.get(row.wallet);
      if (row.botName) w.botName = row.botName;
      w.house = w.house || house;
      w.roundsEntered.push(roundId);
      if (row.prizeEligible && pulseRuleApplies(roundId)) {
        w.pulseQualifiedRoundIds.push(roundId);
      }
      if (round.status === "scored" && row.avgAbsPctError != null) {
        w.scoredErrors.push({ roundId, avgAbsPctError: row.avgAbsPctError });
      }
    }
  }

  const enforcedRoundIds = bounds.roundIds.filter((id) => pulseRuleApplies(id));
  const all = [];
  for (const w of byWallet.values()) {
    const entered = w.roundsEntered.length;
    const house = Boolean(w.house);
    const meetsMin = entered >= WEEKLY_MIN_ROUNDS;
    // For weeks that began before enforcement (Nov 9–15 2026), only days from
    // 2026-11-13 onward count toward "qualified under this rule on at least one day".
    const pulseOk = enforcedRoundIds.length === 0 || w.pulseQualifiedRoundIds.length > 0;
    const eligible = meetsMin && !house && pulseOk;
    let ineligibleReason = null;
    if (house) ineligibleReason = "house bot";
    else if (!meetsMin) ineligibleReason = `fewer than ${WEEKLY_MIN_ROUNDS} complete daily rounds`;
    else if (!pulseOk) ineligibleReason = NO_PULSE_REASON;
    const avg =
      w.scoredErrors.length > 0
        ? w.scoredErrors.reduce((s, e) => s + e.avgAbsPctError, 0) / w.scoredErrors.length
        : null;
    all.push({
      wallet: w.wallet,
      botName: w.botName,
      roundsEntered: entered,
      roundsScored: w.scoredErrors.length,
      roundIds: w.roundsEntered.slice().sort(),
      pulseQualifiedRoundIds: w.pulseQualifiedRoundIds.slice().sort(),
      avgAbsPctError: avg,
      house,
      prizeEligible: eligible,
      eligible,
      ineligibleReason,
      minRoundsRequired: WEEKLY_MIN_ROUNDS,
    });
  }

  all.sort((a, b) => {
    if (a.avgAbsPctError == null && b.avgAbsPctError == null) {
      return a.wallet.localeCompare(b.wallet);
    }
    if (a.avgAbsPctError == null) return 1;
    if (b.avgAbsPctError == null) return -1;
    if (a.avgAbsPctError !== b.avgAbsPctError) return a.avgAbsPctError - b.avgAbsPctError;
    return a.wallet.localeCompare(b.wallet);
  });

  let prizeRank = 0;
  const rows = all.map((r, i) => {
    const out = { rank: i + 1, ...r };
    if (r.prizeEligible) {
      prizeRank += 1;
      out.prizeRank = prizeRank;
    } else {
      out.prizeRank = null;
    }
    return out;
  });
  const ineligible = rows.filter((r) => !r.prizeEligible);
  const prizeWinner = rows.find((r) => r.prizeEligible && r.prizeRank === 1) || null;

  return {
    weekId: bounds.weekId,
    startRoundId: bounds.startRoundId,
    endRoundId: bounds.endRoundId,
    roundIds: bounds.roundIds,
    pulseRuleRoundIds: enforcedRoundIds,
    label: bounds.label,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    weeklyPrizeUsdc: WEEKLY_PRIZE_USDC,
    minRounds: WEEKLY_MIN_ROUNDS,
    ranking: rows,
    ineligible,
    winner: prizeWinner,
    prizeWinner,
  };
}
