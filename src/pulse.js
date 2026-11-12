/**
 * Aggregates free public market data into a compact agent-ready JSON pulse.
 * Sources need no API key / signup. Failures are isolated (partial results OK).
 */
import { withSummary } from "./summary.js";

const CACHE_TTL_MS = 60_000;
/** Free sample may be up to ~15 minutes old so it cannot replace the paid live pulse. */
const SAMPLE_TTL_MS = 15 * 60_000;

let cache = { at: 0, value: null };
let sampleCache = { at: 0, value: null };

const TIMEOUT_MS = 12_000;

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function field(ok, value, source, error) {
  const out = {
    ok,
    source,
    fetchedAt: new Date().toISOString(),
  };
  if (ok) Object.assign(out, value);
  else out.error = String(error?.message || error || "unknown");
  return out;
}

async function spots() {
  try {
    const data = await fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,sui,hyperliquid,zcash&vs_currencies=usd&include_24hr_change=true",
    );
    return field(
      true,
      {
        usd: {
          BTC: data.bitcoin?.usd ?? null,
          ETH: data.ethereum?.usd ?? null,
          SOL: data.solana?.usd ?? null,
          SUI: data.sui?.usd ?? null,
          HYPE: data.hyperliquid?.usd ?? null,
          ZEC: data.zcash?.usd ?? null,
        },
        change24hPct: {
          BTC: data.bitcoin?.usd_24h_change ?? null,
          ETH: data.ethereum?.usd_24h_change ?? null,
          SOL: data.solana?.usd_24h_change ?? null,
          SUI: data.sui?.usd_24h_change ?? null,
          HYPE: data.hyperliquid?.usd_24h_change ?? null,
          ZEC: data.zcash?.usd_24h_change ?? null,
        },
      },
      "https://api.coingecko.com/api/v3/simple/price",
    );
  } catch (e) {
    return field(false, null, "https://api.coingecko.com/api/v3/simple/price", e);
  }
}

async function fearGreed() {
  try {
    const data = await fetchJson("https://api.alternative.me/fng/?limit=1");
    const row = data?.data?.[0];
    return field(
      true,
      {
        value: row ? Number(row.value) : null,
        classification: row?.value_classification ?? null,
        asOf: row?.timestamp
          ? new Date(Number(row.timestamp) * 1000).toISOString()
          : null,
      },
      "https://api.alternative.me/fng/",
    );
  } catch (e) {
    return field(false, null, "https://api.alternative.me/fng/", e);
  }
}

async function hyperliquidFunding() {
  const source = "https://api.hyperliquid.xyz/info (metaAndAssetCtxs)";
  try {
    const data = await fetchJson("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const universe = data?.[0]?.universe || [];
    const ctxs = data?.[1] || [];
    const want = ["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"];
    const rates = {};
    for (const name of want) {
      const i = universe.findIndex((u) => u.name === name);
      if (i < 0) {
        rates[name] = null;
        continue;
      }
      rates[name] = {
        funding: ctxs[i]?.funding != null ? Number(ctxs[i].funding) : null,
        markPx: ctxs[i]?.markPx != null ? Number(ctxs[i].markPx) : null,
        openInterest:
          ctxs[i]?.openInterest != null ? Number(ctxs[i].openInterest) : null,
      };
    }
    return field(true, { rates }, source);
  } catch (e) {
    return field(false, null, source, e);
  }
}

async function defiLlama() {
  const source = "https://api.llama.fi/v2/chains + https://yields.llama.fi/pools";
  try {
    const [chains, yieldsBody] = await Promise.all([
      fetchJson("https://api.llama.fi/v2/chains"),
      fetchJson("https://yields.llama.fi/pools"),
    ]);
    const totalTvlUsd = (chains || []).reduce((s, c) => s + (c.tvl || 0), 0);
    const topChains = (chains || [])
      .filter((c) => c.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 5)
      .map((c) => ({ name: c.name, tvlUsd: Math.round(c.tvl) }));

    const pools = (yieldsBody?.data || [])
      .filter(
        (p) =>
          p.stablecoin &&
          p.tvlUsd > 10_000_000 &&
          p.apy > 0 &&
          p.apy < 50,
      )
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 5)
      .map((p) => ({
        project: p.project,
        symbol: p.symbol,
        chain: p.chain,
        apy: Number(p.apy.toFixed(2)),
        tvlUsd: Math.round(p.tvlUsd),
      }));

    return field(
      true,
      {
        totalTvlUsd: Math.round(totalTvlUsd),
        topChains,
        topStableYields: pools,
      },
      source,
    );
  } catch (e) {
    return field(false, null, source, e);
  }
}

async function fetchFullPulseRaw() {
  const [spotPrices, fearAndGreed, funding, defi] = await Promise.all([
    spots(),
    fearGreed(),
    hyperliquidFunding(),
    defiLlama(),
  ]);
  return {
    service: "crypto-pulse-api",
    networkNote:
      "Market data is from public APIs (live markets). Payment settlement network is configured by the server NETWORK env (devnet|mainnet).",
    generatedAt: new Date().toISOString(),
    spotPrices,
    fearAndGreed,
    hyperliquidFunding: funding,
    defi,
  };
}

/**
 * Build full pulse, optionally filtered to one asset ticker (BTC/ETH/SOL/SUI/HYPE/ZEC/ZEC).
 * Includes top-level `summary` (plain English) and `signals` (deterministic).
 */
export async function buildPulse({ asset } = {}) {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS && !asset) {
    return {
      ...withSummary(cache.value),
      cache: { hit: true, ttlSeconds: CACHE_TTL_MS / 1000 },
    };
  }

  const raw = await fetchFullPulseRaw();
  let pulse = {
    ...raw,
    cache: { hit: false, ttlSeconds: CACHE_TTL_MS / 1000 },
  };

  if (!asset) {
    cache = { at: now, value: { ...raw } };
    return withSummary(pulse);
  }

  const key = String(asset).toUpperCase();
  const spotPrices = raw.spotPrices;
  const funding = raw.hyperliquidFunding;
  pulse = {
    service: raw.service,
    networkNote: raw.networkNote,
    generatedAt: raw.generatedAt,
    asset: key,
    spot: spotPrices.ok
      ? {
          usd: spotPrices.usd?.[key] ?? null,
          change24hPct: spotPrices.change24hPct?.[key] ?? null,
          source: spotPrices.source,
          fetchedAt: spotPrices.fetchedAt,
        }
      : spotPrices,
    funding: funding.ok
      ? {
          ...(funding.rates?.[key] || null),
          source: funding.source,
          fetchedAt: funding.fetchedAt,
        }
      : funding,
    fearAndGreed: raw.fearAndGreed,
    defi: raw.defi,
    cache: { hit: false, ttlSeconds: CACHE_TTL_MS / 1000 },
  };

  return withSummary(pulse);
}

/**
 * Spots-only payload for the cheaper /v1/spots endpoint.
 */
export async function buildSpots() {
  const spotPrices = await spots();
  return withSummary({
    service: "crypto-pulse-api",
    generatedAt: new Date().toISOString(),
    spotPrices,
    cache: { hit: false, ttlSeconds: CACHE_TTL_MS / 1000 },
  });
}

/**
 * Free sample: same shape as /v1/pulse, but may be up to SAMPLE_TTL_MS old.
 * Labeled so agents know it is not the live paid feed.
 */
export async function buildSample() {
  const now = Date.now();
  if (sampleCache.value && now - sampleCache.at < SAMPLE_TTL_MS) {
    const age = Math.floor((now - sampleCache.at) / 1000);
    return {
      ...withSummary(sampleCache.value),
      sample: true,
      dataAgeSeconds: age,
      sampleNote:
        "Free sample may be up to 15 minutes old. For live data pay GET /v1/pulse ($0.02 USDC) or GET /v1/spots ($0.005).",
      cache: { hit: true, ttlSeconds: SAMPLE_TTL_MS / 1000 },
    };
  }

  // Prefer reusing a fresh live cache if present, else fetch.
  let raw;
  if (cache.value && now - cache.at < CACHE_TTL_MS) {
    raw = { ...cache.value };
  } else {
    raw = await fetchFullPulseRaw();
    cache = { at: now, value: { ...raw } };
  }

  sampleCache = { at: now, value: { ...raw } };
  return {
    ...withSummary(raw),
    sample: true,
    dataAgeSeconds: 0,
    sampleNote:
      "Free sample may be up to 15 minutes old. For live data pay GET /v1/pulse ($0.02 USDC) or GET /v1/spots ($0.005).",
    cache: { hit: false, ttlSeconds: SAMPLE_TTL_MS / 1000 },
  };
}

export function clearPulseCache() {
  cache = { at: 0, value: null };
  sampleCache = { at: 0, value: null };
}

export { CACHE_TTL_MS, SAMPLE_TTL_MS };
