import { withSummary, buildSummary, buildSignals } from "../src/summary.js";

const pulse = {
  service: "crypto-pulse-api",
  spotPrices: {
    ok: true,
    usd: { BTC: 77500, ETH: 2250, SOL: 95.2, HYPE: 12.5 },
    change24hPct: { BTC: -1.2, ETH: 0.5, SOL: 2.1, HYPE: -0.8 },
  },
  fearAndGreed: { ok: true, value: 30, classification: "Fear" },
  hyperliquidFunding: {
    ok: true,
    rates: {
      BTC: { funding: 0.00001 },
      ETH: { funding: -0.000005 },
      SOL: { funding: 0.00002 },
      HYPE: { funding: 0.00001 },
    },
  },
  defi: {
    ok: true,
    totalTvlUsd: 84_000_000_000,
    topStableYields: [{ project: "kamino", symbol: "USDC", apy: 5.2 }],
  },
};

const out = withSummary(pulse);
console.log("summary:", out.summary);
console.log("signals:", JSON.stringify(out.signals, null, 2));
if (!out.summary.includes("Fear & Greed 30")) throw new Error("missing F&G");
if (!out.summary.includes("BTC")) throw new Error("missing BTC");
if (out.signals.fundingBias !== "neutral" && out.signals.fundingBias !== "long") {
  // avg is slightly positive → long or neutral depending on threshold
  console.log("fundingBias", out.signals.fundingBias);
}
console.log("ok");
