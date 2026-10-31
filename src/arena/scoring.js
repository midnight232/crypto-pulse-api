/**
 * Score a closed arena round against CoinGecko spots (same source as /v1/spots).
 * Never sends funds. Rankings only.
 */
import { ARENA_ASSETS } from "./rounds.js";

async function fetchClosingSpots() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const usd = {
      BTC: data.bitcoin?.usd ?? null,
      ETH: data.ethereum?.usd ?? null,
      SOL: data.solana?.usd ?? null,
    };
    for (const a of ARENA_ASSETS) {
      if (usd[a] == null || !Number.isFinite(Number(usd[a]))) {
        throw new Error(`missing_spot_${a}`);
      }
    }
    return {
      BTC: Number(usd.BTC),
      ETH: Number(usd.ETH),
      SOL: Number(usd.SOL),
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
 * Only wallets with all three assets count for ranking.
 */
export function buildLeaderboard(round) {
  if (!round) return { rows: [], incomplete: [] };

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
    const missing = ARENA_ASSETS.filter((a) => !row.assets[a]);
    if (missing.length) {
      incomplete.push({
        wallet: row.wallet,
        botName: row.botName,
        assetsPresent: ARENA_ASSETS.filter((a) => row.assets[a]),
        missing,
      });
      continue;
    }
    const errors = ARENA_ASSETS.map((a) => row.assets[a].absPctError);
    const scored = round.status === "scored" && errors.every((e) => e != null);
    const avgError = scored
      ? errors.reduce((s, e) => s + e, 0) / errors.length
      : null;
    complete.push({
      wallet: row.wallet,
      botName: row.botName,
      firstSubmittedAt: row.firstSubmittedAt,
      avgAbsPctError: avgError,
      perAsset: Object.fromEntries(
        ARENA_ASSETS.map((a) => [
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

  const rows = complete.map((r, i) => ({ rank: i + 1, ...r }));
  return { rows, incomplete };
}

export async function scoreRound(store, roundId, { fetchSpots = fetchClosingSpots } = {}) {
  const round = store.getRound(roundId);
  if (!round) return { ok: false, reason: "round_missing" };
  if (round.status === "scored" && round.closes) {
    return { ok: true, already: true, roundId, closes: round.closes };
  }

  const closes = await fetchSpots();
  const errorMap = {};
  for (const p of round.predictions) {
    const actual = closes[p.asset];
    errorMap[`${p.wallet}|${p.asset}`] = absPctError(p.price, actual);
  }
  store.applyErrors(roundId, errorMap);
  store.setRoundCloses(roundId, closes, "scored");
  return { ok: true, already: false, roundId, closes };
}
