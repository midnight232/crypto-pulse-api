/**
 * Score a closed arena round against CoinGecko spots (same source as /v1/spots).
 * Never sends funds. Rankings only.
 */
import { arenaAssetsForRound, coingeckoIdsForAssets, ARENA_COINGECKO_IDS } from "./rounds.js";
import { isHouseEntrant } from "./house.js";
import { getPulseUsageStore, pulseQualification, NO_PULSE_REASON } from "../pulse-usage.js";

async function fetchClosingSpots(roundId) {
  const assets = arenaAssetsForRound(roundId);
  const ids = coingeckoIdsForAssets(assets);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const closes = {};
    for (const a of assets) {
      const id = ARENA_COINGECKO_IDS[a];
      const v = data[id]?.usd ?? null;
      if (v == null || !Number.isFinite(Number(v))) {
        throw new Error(`missing_spot_${a}`);
      }
      closes[a] = Number(v);
    }
    return {
      ...closes,
      fetchedAt: new Date().toISOString(),
      source: url,
    };
  } finally {
    clearTimeout(t);
  }
}

export function absPctError(predicted, actual) {
  const p = Number(predicted);
  const a = Number(actual);
  if (!Number.isFinite(p) || !Number.isFinite(a) || a === 0) return null;
  return (Math.abs(p - a) / a) * 100;
}

/**
 * Build leaderboard rows for a round.
 * Only wallets with every asset in that round's set count for ranking.
 */
export function buildLeaderboard(round, { usage = getPulseUsageStore() } = {}) {
  if (!round) return { rows: [], incomplete: [], prizeWinner: null };

  const assets = arenaAssetsForRound(round.roundId);
  const byWallet = new Map();
  for (const p of round.predictions) {
    if (!byWallet.has(p.wallet)) {
      byWallet.set(p.wallet, {
        wallet: p.wallet,
        botName: p.botName || null,
        assets: {},
        firstSubmittedAt: p.submittedAt,
      });
    }
    const row = byWallet.get(p.wallet);
    row.assets[p.asset] = {
      price: p.price,
      absPctError: p.absPctError,
      submittedAt: p.submittedAt,
      updatedAt: p.updatedAt,
    };
    if (p.botName) row.botName = p.botName;
    if (p.submittedAt < row.firstSubmittedAt) row.firstSubmittedAt = p.submittedAt;
  }

  const complete = [];
  const incomplete = [];
  for (const row of byWallet.values()) {
    const missing = assets.filter((a) => !row.assets[a]);
    if (missing.length) {
      incomplete.push({
        wallet: row.wallet,
        botName: row.botName,
        assetsPresent: assets.filter((a) => row.assets[a]),
        missing,
      });
      continue;
    }
    const errors = assets.map((a) => row.assets[a].absPctError);
    const scored = round.status === "scored" && errors.every((e) => e != null);
    const avgError = scored
      ? errors.reduce((s, e) => s + e, 0) / errors.length
      : null;
    const house = isHouseEntrant({ wallet: row.wallet, botName: row.botName });
    const pulse = pulseQualification({ wallet: row.wallet, roundId: round.roundId, usage });
    const prizeEligible = !house && pulse.qualified;
    let ineligibleReason = null;
    if (house) ineligibleReason = "house bot";
    else if (pulse.applies && !pulse.qualified) ineligibleReason = NO_PULSE_REASON;
    complete.push({
      wallet: row.wallet,
      botName: row.botName,
      firstSubmittedAt: row.firstSubmittedAt,
      avgAbsPctError: avgError,
      house,
      pulseQualified: pulse.qualified,
      pulseDay: pulse.day,
      prizeEligible,
      eligible: prizeEligible,
      ineligibleReason,
      perAsset: Object.fromEntries(
        assets.map((a) => [
          a,
          {
            predicted: row.assets[a].price,
            absPctError: row.assets[a].absPctError,
            actual: round.closes ? round.closes[a] : null,
          },
        ]),
      ),
    });
  }

  complete.sort((a, b) => {
    if (a.avgAbsPctError == null && b.avgAbsPctError == null) {
      return a.firstSubmittedAt.localeCompare(b.firstSubmittedAt);
    }
    if (a.avgAbsPctError == null) return 1;
    if (b.avgAbsPctError == null) return -1;
    if (a.avgAbsPctError !== b.avgAbsPctError) {
      return a.avgAbsPctError - b.avgAbsPctError;
    }
    return a.firstSubmittedAt.localeCompare(b.firstSubmittedAt);
  });

  let prizeRank = 0;
  const rows = complete.map((r, i) => {
    const out = { rank: i + 1, ...r };
    if (r.prizeEligible) {
      prizeRank += 1;
      out.prizeRank = prizeRank;
    } else {
      out.prizeRank = null;
    }
    return out;
  });
  const prizeWinner = rows.find((r) => r.prizeEligible && r.prizeRank === 1) || null;
  return { rows, incomplete, prizeWinner };
}

export async function scoreRound(store, roundId, { fetchSpots = fetchClosingSpots } = {}) {
  const round = store.getRound(roundId);
  if (!round) return { ok: false, reason: "round_missing" };
  if (round.status === "scored" && round.closes) {
    return { ok: true, already: true, roundId, closes: round.closes };
  }

  const closes = await fetchSpots(roundId);
  const errorMap = {};
  for (const p of round.predictions) {
    const actual = closes[p.asset];
    errorMap[`${p.wallet}|${p.asset}`] = absPctError(p.price, actual);
  }
  store.applyErrors(roundId, errorMap);
  store.setRoundCloses(roundId, closes, "scored");
  return { ok: true, already: false, roundId, closes };
}
