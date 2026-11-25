/**
 * Pulse Forge signal modules and starter templates.
 * Quotes are deterministic functions of a pulse snapshot plus the house
 * strategies (baseline, momentum, mean-revert). No network, no keys, no prizes.
 */
import { ARENA_ASSETS } from "../rounds.js";
import { predictForStrategy } from "../house.js";
import { normalizePrice } from "../verify.js";

export const FORGE_MESSAGE_PREFIX = "crypto-pulse-forge:v1";

const MODULE_DEFS = [
  {
    id: "baseline",
    label: "Baseline",
    source: "house baseline + CoinGecko spot",
    summary: "Predict the current USD spot (naive hold-to-close).",
    formula: "spot",
  },
  {
    id: "momentum",
    label: "Momentum",
    source: "house momentum + 24h change",
    summary: "Extrapolate the last 24h percent change once from the current spot.",
    formula: "spot * (1 + change24hPct/100)",
  },
  {
    id: "meanrevert",
    label: "Mean reversion",
    source: "house mean-revert + 24h change",
    summary: "Fade half of the last 24h percent change from the current spot.",
    formula: "spot * (1 - 0.5 * change24hPct/100)",
  },
  {
    id: "feargreed",
    label: "Fear & Greed",
    source: "alternative.me Fear & Greed",
    summary: "Contrarian tilt from the Fear & Greed index. Extreme fear lifts the quote; extreme greed fades it. Max ±2%. Missing index uses the spot.",
    formula: "spot * (1 + clamp((50 - index) / 50, -1, 1) * 0.02)",
  },
  {
    id: "funding",
    label: "Funding fade",
    source: "Hyperliquid funding",
    summary: "Fade crowded perpetual funding. Positive funding lowers the quote. Daily-ized rate, capped at ±3%. Missing funding uses the spot.",
    formula: "spot * (1 - clamp(fundingHourly * 24, -0.03, 0.03))",
  },
  {
    id: "defi",
    label: "DeFi yields",
    source: "DefiLlama stablecoin yields",
    summary: "Lean with the 24h move when average stablecoin yield is above 5%, and against it when yield is below 5%. Cap ±1.5%. Missing yields use the spot.",
    formula: "spot * (1 + sign(change24hPct) * clamp((avgStableApy - 5) / 100, -0.015, 0.015))",
  },
];

const MODULE_BY_ID = new Map(MODULE_DEFS.map((m) => [m.id, m]));

export const FORGE_TEMPLATES = Object.freeze([
  {
    id: "baseline",
    label: "Baseline hold",
    summary: "House baseline: predict the current spot for BTC, ETH, and SOL.",
    modules: [{ id: "baseline", weight: 1 }],
  },
  {
    id: "momentum",
    label: "Momentum",
    summary: "House momentum: extrapolate the last 24h percent change once.",
    modules: [{ id: "momentum", weight: 1 }],
  },
  {
    id: "mean-revert",
    label: "Mean reversion",
    summary: "House mean-revert: fade half of the last 24h move.",
    modules: [{ id: "meanrevert", weight: 1 }],
  },
  {
    id: "fear-greed",
    label: "Fear & Greed fade",
    summary: "Contrarian Fear & Greed tilt blended with mean reversion.",
    modules: [
      { id: "feargreed", weight: 0.6 },
      { id: "meanrevert", weight: 0.4 },
    ],
  },
  {
    id: "funding-fade",
    label: "Funding fade",
    summary: "Fade crowded Hyperliquid funding, anchored to the spot.",
    modules: [
      { id: "funding", weight: 0.7 },
      { id: "baseline", weight: 0.3 },
    ],
  },
  {
    id: "defi-yield",
    label: "DeFi yield tilt",
    summary: "Stablecoin-yield tilt mixed with momentum.",
    modules: [
      { id: "defi", weight: 0.5 },
      { id: "momentum", weight: 0.5 },
    ],
  },
  {
    id: "balanced",
    label: "Balanced forge",
    summary: "Equal weight on baseline, momentum, mean-revert, Fear & Greed, funding, and DeFi yields.",
    modules: [
      { id: "baseline", weight: 1 },
      { id: "momentum", weight: 1 },
      { id: "meanrevert", weight: 1 },
      { id: "feargreed", weight: 1 },
      { id: "funding", weight: 1 },
      { id: "defi", weight: 1 },
    ],
  },
]);

const TEMPLATE_BY_ID = new Map(FORGE_TEMPLATES.map((t) => [t.id, t]));

export const ASSET_PRESETS = Object.freeze([
  {
    id: "all",
    label: "BTC, ETH, and SOL",
    assets: ["BTC", "ETH", "SOL"],
    note: "Full arena set. Ranking requires a prediction for every asset.",
  },
  {
    id: "btc",
    label: "BTC only",
    assets: ["BTC"],
    note: "Partial entry. The wallet is not ranked until ETH and SOL are added.",
  },
  {
    id: "eth",
    label: "ETH only",
    assets: ["ETH"],
    note: "Partial entry. The wallet is not ranked until BTC and SOL are added.",
  },
  {
    id: "sol",
    label: "SOL only",
    assets: ["SOL"],
    note: "Partial entry. The wallet is not ranked until BTC and ETH are added.",
  },
]);

const PRESET_BY_ID = new Map(ASSET_PRESETS.map((p) => [p.id, p]));

function fail(message, code, status = 400, extra = {}) {
  throw Object.assign(new Error(message), { code, status, ...extra });
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function numberOrNull(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function listSignalModules() {
  return MODULE_DEFS.map(({ id, label, source, summary, formula }) => ({
    id,
    label,
    source,
    summary,
    formula,
  }));
}

export function listForgeTemplates() {
  return FORGE_TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    summary: t.summary,
    modules: t.modules.map((m) => ({ ...m })),
  }));
}

export function listAssetPresets() {
  return ASSET_PRESETS.map((p) => ({ ...p, assets: p.assets.slice() }));
}

export function getTemplate(id) {
  return TEMPLATE_BY_ID.get(String(id || "").trim()) || null;
}

export function canonicalWeight(weight) {
  const n = typeof weight === "number" ? weight : Number(weight);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    fail("module weight must be a number greater than 0 and at most 100", "invalid_weight");
  }
  const canonical = n.toFixed(4).replace(/\.?0+$/, "");
  return { value: Number(canonical), canonical };
}

export function normalizeModules(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    fail("at least one signal module is required", "invalid_modules");
  }
  if (modules.length > 8) fail("at most 8 modules", "invalid_modules");
  const seen = new Set();
  const out = [];
  for (const row of modules) {
    const id = String(row?.id || "").trim();
    if (!MODULE_BY_ID.has(id)) fail(`unknown signal module: ${id || "(missing)"}`, "unknown_module");
    if (seen.has(id)) fail(`duplicate signal module: ${id}`, "invalid_modules");
    seen.add(id);
    const weight = canonicalWeight(row.weight);
    out.push({ id, weight: weight.value });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function normalizeForgeAssets({ assets, assetPreset } = {}) {
  let list = assets;
  let presetId = null;
  if (list == null || (Array.isArray(list) && list.length === 0)) {
    if (assetPreset) {
      const preset = PRESET_BY_ID.get(String(assetPreset).trim());
      if (!preset) fail(`unknown asset preset: ${assetPreset}`, "unknown_asset_preset");
      list = preset.assets;
      presetId = preset.id;
    } else {
      list = ARENA_ASSETS;
      presetId = "all";
    }
  }
  if (!Array.isArray(list) || list.length === 0) fail("at least one asset is required", "invalid_assets");
  const allowed = new Set(ARENA_ASSETS);
  const picked = [];
  for (const raw of list) {
    const asset = String(raw || "").trim().toUpperCase();
    if (!allowed.has(asset)) fail(`asset must be one of ${ARENA_ASSETS.join(", ")}`, "invalid_assets");
    if (!picked.includes(asset)) picked.push(asset);
  }
  picked.sort((a, b) => ARENA_ASSETS.indexOf(a) - ARENA_ASSETS.indexOf(b));
  return { assets: picked, assetPreset: presetId };
}

/**
 * Accept a normalized snapshot or a /v1/pulse (or /v1/sample) payload.
 */
export function normalizeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("snapshot required: pass pulse JSON or { spots, fearGreed, funding, defi }", "snapshot_required");
  }
  const spots = {};
  if (input.spotPrices && typeof input.spotPrices === "object") {
    const usd = input.spotPrices.usd || {};
    const change = input.spotPrices.change24hPct || {};
    for (const asset of new Set([...Object.keys(usd), ...Object.keys(change)])) {
      spots[asset] = { usd: numberOrNull(usd[asset]), change24hPct: numberOrNull(change[asset]) };
    }
  } else if (input.spots && typeof input.spots === "object") {
    for (const [asset, row] of Object.entries(input.spots)) {
      if (row && typeof row === "object") {
        spots[asset] = { usd: numberOrNull(row.usd), change24hPct: numberOrNull(row.change24hPct) };
      } else {
        spots[asset] = { usd: numberOrNull(row), change24hPct: null };
      }
    }
  }

  let fearValue = null;
  if (input.fearAndGreed && typeof input.fearAndGreed === "object") fearValue = numberOrNull(input.fearAndGreed.value);
  else if (input.fearGreed && typeof input.fearGreed === "object") fearValue = numberOrNull(input.fearGreed.value);
  else if (input.fearGreed != null && typeof input.fearGreed !== "object") fearValue = numberOrNull(input.fearGreed);

  const funding = {};
  const rateSource =
    input.hyperliquidFunding?.rates && typeof input.hyperliquidFunding.rates === "object"
      ? input.hyperliquidFunding.rates
      : input.funding && typeof input.funding === "object"
        ? input.funding
        : null;
  if (rateSource) {
    for (const [asset, row] of Object.entries(rateSource)) {
      funding[asset] = row && typeof row === "object" ? numberOrNull(row.funding) : numberOrNull(row);
    }
  }

  let apy = null;
  if (input.defi && typeof input.defi === "object" && input.defi.avgStableApy != null) {
    apy = numberOrNull(input.defi.avgStableApy);
  } else if (Array.isArray(input.defi?.topStableYields)) {
    const vals = input.defi.topStableYields.map((p) => Number(p?.apy)).filter((n) => Number.isFinite(n));
    apy = vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
  }

  return {
    spots,
    fearGreed: { value: fearValue },
    funding,
    defi: { avgStableApy: apy },
  };
}

function spotRow(ctx, asset) {
  const row = ctx.spots?.[asset];
  if (!row || !Number.isFinite(row.usd) || row.usd <= 0) {
    fail(`snapshot is missing a positive USD spot for ${asset}`, "missing_spot", 400, { asset });
  }
  const change24hPct = Number.isFinite(row.change24hPct) ? row.change24hPct : 0;
  return { usd: row.usd, change24hPct };
}

function houseQuote(strategyId, asset, ctx) {
  const row = spotRow(ctx, asset);
  const spots = { [asset]: { usd: row.usd, change24hPct: row.change24hPct } };
  const price = predictForStrategy(strategyId, asset, spots);
  return { price, fallback: false };
}

export function quoteModule(moduleId, asset, ctx) {
  const quoted = quoteModuleRaw(moduleId, asset, ctx);
  return { ...quoted, price: priceCanonical(quoted.price).value };
}

function quoteModuleRaw(moduleId, asset, ctx) {
  const id = String(moduleId || "").trim();
  if (!MODULE_BY_ID.has(id)) fail(`unknown signal module: ${id}`, "unknown_module");
  if (id === "baseline" || id === "momentum" || id === "meanrevert") {
    return { id, ...houseQuote(id, asset, ctx) };
  }
  const row = spotRow(ctx, asset);
  if (id === "feargreed") {
    const fg = ctx.fearGreed?.value;
    if (fg == null) return { id, price: row.usd, fallback: true };
    const tilt = clamp((50 - fg) / 50, -1, 1) * 0.02;
    return { id, price: row.usd * (1 + tilt), fallback: false };
  }
  if (id === "funding") {
    const fr = ctx.funding?.[asset];
    if (fr == null) return { id, price: row.usd, fallback: true };
    const tilt = clamp(fr * 24, -0.03, 0.03);
    return { id, price: row.usd * (1 - tilt), fallback: false };
  }
  const apy = ctx.defi?.avgStableApy;
  if (apy == null) return { id, price: row.usd, fallback: true };
  const sign = row.change24hPct === 0 ? 0 : Math.sign(row.change24hPct);
  const tilt = sign * clamp((apy - 5) / 100, -0.015, 0.015);
  return { id, price: row.usd * (1 + tilt), fallback: false };
}

export function blendModuleQuotes(parts) {
  let weightSum = 0;
  let acc = 0;
  for (const part of parts) {
    if (!(part.weight > 0) || !Number.isFinite(part.price)) continue;
    weightSum += part.weight;
    acc += part.weight * part.price;
  }
  if (!(weightSum > 0)) fail("at least one module weight must be positive", "invalid_modules");
  return acc / weightSum;
}

export function modulesCanonical(modules) {
  return modules.map((m) => `${m.id}:${canonicalWeight(m.weight).canonical}`).join(",");
}

export function buildForgeConfigMessage({ wallet, botName, templateId, modules, assets }) {
  return [
    FORGE_MESSAGE_PREFIX,
    `wallet=${wallet}`,
    `name=${botName}`,
    `template=${templateId || "custom"}`,
    `modules=${modulesCanonical(modules)}`,
    `assets=${assets.join(",")}`,
  ].join("|");
}

export function describeForgeCatalog() {
  return {
    name: "Pulse Forge",
    phase: 1,
    cashPrizes: "unchanged",
    autopay: "unchanged",
    paidCallEligibility: "unchanged",
    note:
      "Free bot builder on the existing Arena. Modules quote a daily close from pulse data and the house strategies. XP, levels, streaks, badges, share cards, and Pro-day credits are non-cash. They do not change prize amounts, autopay, or who is prize-eligible.",
    modules: listSignalModules(),
    templates: listForgeTemplates(),
    assetPresets: listAssetPresets(),
    signing: {
      configPrefix: FORGE_MESSAGE_PREFIX,
      config:
        "Sign the canonical config message with the payout wallet (ed25519, signature base58). POST /v1/forge/config-message returns the exact bytes. The server never receives private keys.",
      entry:
        "Preview returns one arena canonical message per asset. Sign each, then POST /v1/forge/enter. Entry uses the existing predict path, including prize eligibility.",
    },
    endpoints: {
      catalog: "GET /v1/forge",
      modules: "GET /v1/forge/modules",
      templates: "GET /v1/forge/templates",
      configMessage: "POST /v1/forge/config-message",
      configure: "POST /v1/forge/bots",
      bot: "GET /v1/forge/bots/:wallet",
      preview: "POST /v1/forge/preview",
      enter: "POST /v1/forge/enter",
      progress: "GET /v1/forge/progress/:wallet",
      xpLeaderboard: "GET /v1/forge/leaderboard",
      referrals: "GET /v1/forge/referrals?wallet=",
      roundCard: "GET /v1/forge/cards/round/:roundId/:wallet.svg",
      streakCard: "GET /v1/forge/cards/streak/:wallet.svg",
      sharePage: "GET /arena/forge/share/:roundId/:wallet",
    },
  };
}

export function priceCanonical(price) {
  return normalizePrice(price);
}
