/**
 * Weekly arena leaderboard helpers.
 */
import { buildLeaderboard } from "./scoring.js";
import { isHouseEntrant } from "./house.js";
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
        });
      }
      const w = byWallet.get(row.wallet);
      if (row.botName) w.botName = row.botName;
      w.house = w.house || house;
      w.roundsEntered.push(roundId);
      if (round.status === "scored" && row.avgAbsPctError != null) {
        w.scoredErrors.push({ roundId, avgAbsPctError: row.avgAbsPctError });
      }
    }
  }

  const ranking = [];
  const ineligible = [];
  for (const w of byWallet.values()) {
    const entered = w.roundsEntered.length;
    const house = Boolean(w.house);
    const meetsMin = entered >= WEEKLY_MIN_ROUNDS;
    const eligible = meetsMin && !house;
    const avg =
      w.scoredErrors.length > 0
        ? w.scoredErrors.reduce((s, e) => s + e.avgAbsPctError, 0) / w.scoredErrors.length
        : null;
    const row = {
      wallet: w.wallet,
      botName: w.botName,
      roundsEntered: entered,
      roundsScored: w.scoredErrors.length,
      roundIds: w.roundsEntered.slice().sort(),
      avgAbsPctError: avg,
      house,
      prizeEligible: eligible,
      eligible,
      minRoundsRequired: WEEKLY_MIN_ROUNDS,
    };
    if (eligible) ranking.push(row);
    else ineligible.push(row);
  }

  ranking.sort((a, b) => {
    if (a.avgAbsPctError == null && b.avgAbsPctError == null) {
      return a.wallet.localeCompare(b.wallet);
    }
    if (a.avgAbsPctError == null) return 1;
    if (b.avgAbsPctError == null) return -1;
    if (a.avgAbsPctError !== b.avgAbsPctError) return a.avgAbsPctError - b.avgAbsPctError;
    return a.wallet.localeCompare(b.wallet);
  });

  const rows = ranking.map((r, i) => ({ rank: i + 1, ...r }));

  return {
    weekId: bounds.weekId,
    startRoundId: bounds.startRoundId,
    endRoundId: bounds.endRoundId,
    roundIds: bounds.roundIds,
    label: bounds.label,
    prize: prizePoolLabel(),
    prizeShort: prizePoolShort(),
    weeklyPrizeUsdc: WEEKLY_PRIZE_USDC,
    minRounds: WEEKLY_MIN_ROUNDS,
    ranking: rows,
    ineligible,
    winner: rows[0] || null,
    prizeWinner: rows[0] || null,
  };
}
