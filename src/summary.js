/**
 * Deterministic plain-English summary + signals from pulse/spots payloads.
 * Never invents numbers — only formats fields that are present and ok.
 */

function fmtUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}k`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(2)}k`;
  if (Math.abs(v) >= 100) return `$${v.toFixed(0)}`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

/**
 * Average Hyperliquid funding across available majors.
 * |avg| < 1e-5 → neutral; >0 long-biased (longs pay shorts); <0 short-biased.
 */
function fundingBiasFromRates(rates) {
  if (!rates || typeof rates !== "object") {
    return { fundingBias: "unknown", fundingAvg: null };
  }
  const vals = [];
  for (const k of ["BTC", "ETH", "SOL", "SUI", "HYPE"]) {
    const f = rates[k]?.funding;
    if (f != null && Number.isFinite(Number(f))) vals.push(Number(f));
  }
  if (!vals.length) return { fundingBias: "unknown", fundingAvg: null };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  let fundingBias = "neutral";
  if (avg > 1e-5) fundingBias = "long";
  else if (avg < -1e-5) fundingBias = "short";
  return { fundingBias, fundingAvg: avg };
}

function spotsPhrase(spotPrices) {
  if (!spotPrices?.ok || !spotPrices.usd) return null;
  const parts = [];
  for (const t of ["BTC", "ETH", "SOL", "SUI", "HYPE"]) {
    const p = fmtUsd(spotPrices.usd[t]);
    if (!p) continue;
    const ch = fmtPct(spotPrices.change24hPct?.[t]);
    parts.push(ch ? `${t} ${p} (${ch} 24h)` : `${t} ${p}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function fearPhrase(fearAndGreed) {
  if (!fearAndGreed?.ok) return null;
  const v = fearAndGreed.value;
  const c = fearAndGreed.classification;
  if (v == null && !c) return null;
  if (v != null && c) return `Fear & Greed ${v} (${c})`;
  if (v != null) return `Fear & Greed ${v}`;
  return `Fear & Greed ${c}`;
}

function fundingPhrase(funding) {
  if (!funding?.ok) return null;
  const { fundingBias, fundingAvg } = fundingBiasFromRates(funding.rates);
  if (fundingBias === "unknown") return "perp funding unavailable";
  const avgStr =
    fundingAvg != null
      ? ` avg ${fundingAvg >= 0 ? "+" : ""}${(fundingAvg * 100).toFixed(4)}%/8h`
      : "";
  if (fundingBias === "neutral") return `perp funding neutral${avgStr}`;
  if (fundingBias === "long") return `perp funding long-biased${avgStr}`;
  return `perp funding short-biased${avgStr}`;
}

function defiPhrase(defi) {
  if (!defi?.ok) return null;
  const tvl = fmtUsd(defi.totalTvlUsd);
  if (!tvl) return null;
  const top = defi.topStableYields?.[0];
  if (top?.project && top.apy != null) {
    return `DeFi TVL ${tvl}; top stable yield ${top.project} ${top.symbol} ${top.apy}% APY`;
  }
  return `DeFi TVL ${tvl}`;
}

/**
 * Build signals object from a full pulse (or asset slice / spots).
 */
export function buildSignals(pulse) {
  const spotPrices = pulse.spotPrices || null;
  const fearAndGreed = pulse.fearAndGreed || null;
  const funding = pulse.hyperliquidFunding || null;
  const defi = pulse.defi || null;

  const spotsOk = Boolean(spotPrices?.ok);
  const fearOk = Boolean(fearAndGreed?.ok);
  const fundingOk = Boolean(funding?.ok);
  const defiOk = Boolean(defi?.ok);

  let sentiment = null;
  let sentimentValue = null;
  if (fearOk) {
    sentiment = fearAndGreed.classification ?? null;
    sentimentValue =
      fearAndGreed.value != null && Number.isFinite(Number(fearAndGreed.value))
        ? Number(fearAndGreed.value)
        : null;
  }

  const { fundingBias, fundingAvg } = fundingOk
    ? fundingBiasFromRates(funding.rates)
    : { fundingBias: "unknown", fundingAvg: null };

  return {
    sentiment,
    sentimentValue,
    fundingBias,
    fundingAvg,
    sourcesOk: { spots: spotsOk, fearAndGreed: fearOk, funding: fundingOk, defi: defiOk },
  };
}

/**
 * One plain-English line from the actual data. Missing sections are omitted.
 */
export function buildSummary(pulse) {
  const parts = [];

  // Asset-slice shape
  if (pulse.asset && pulse.spot) {
    const usd = pulse.spot.usd != null ? fmtUsd(pulse.spot.usd) : null;
    const ch = fmtPct(pulse.spot.change24hPct);
    if (usd) parts.push(`${pulse.asset} ${usd}${ch ? ` (${ch} 24h)` : ""}`);
    if (pulse.funding && pulse.funding.funding != null) {
      const f = Number(pulse.funding.funding);
      if (Number.isFinite(f)) {
        const bias = f > 1e-5 ? "long-biased" : f < -1e-5 ? "short-biased" : "neutral";
        parts.push(
          `funding ${bias} (${f >= 0 ? "+" : ""}${(f * 100).toFixed(4)}%/8h)`,
        );
      }
    }
    const fear = fearPhrase(pulse.fearAndGreed);
    if (fear) parts.push(fear);
    const defi = defiPhrase(pulse.defi);
    if (defi) parts.push(defi);
  } else if (pulse.spotPrices && !pulse.fearAndGreed && !pulse.hyperliquidFunding) {
    // Spots-only
    const spots = spotsPhrase(pulse.spotPrices);
    if (spots) parts.push(spots);
    else parts.push("spot prices unavailable");
  } else {
    // Full pulse
    const fear = fearPhrase(pulse.fearAndGreed);
    if (fear) parts.push(fear);
    const spots = spotsPhrase(pulse.spotPrices);
    if (spots) parts.push(spots);
    const fund = fundingPhrase(pulse.hyperliquidFunding);
    if (fund) parts.push(fund);
    const defi = defiPhrase(pulse.defi);
    if (defi) parts.push(defi);
  }

  if (!parts.length) return "Market data unavailable from upstream sources right now.";
  return parts.join("; ") + ".";
}

/**
 * Attach summary + signals onto a pulse/spots object (mutates and returns).
 */
export function withSummary(pulse) {
  const signals = buildSignals(pulse);
  const summary = buildSummary(pulse);
  return { ...pulse, summary, signals };
}
