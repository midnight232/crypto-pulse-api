/**
 * Crypto Pulse API — x402 pay-per-request on Solana (devnet or mainnet).
 * Set NETWORK=mainnet for production config. Do not settle test payments on mainnet locally.
 */
import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { buildPulse, buildSpots, buildSample } from "./pulse.js";
import {
  NETWORK_MODE,
  IS_MAINNET,
  PRICE,
  PORT,
  HOST,
  FACILITATOR_URL,
  FACILITATOR_NAME,
  PAYAI_FACILITATOR_URL,
  CDP_FACILITATOR_URL,
  USE_CDP_FACILITATOR,
  buildFacilitatorConfig,
  CAIP2,
  USDC_MINT,
  resolvePayTo,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
} from "./config.js";
import {
  SPOTS_PRICE,
  publicBaseUrl,
  serviceDescription,
  shortDescription,
  tags,
  paymentTags,
  paymentSpotsTags,
  paymentDescription,
  paymentSpotsDescription,
  paymentAssetDescription,
  buildLlmsTxt,
  buildWellKnownX402,
  buildOpenApi,
  buildAiCatalog,
  buildMcpServerCard,
} from "./discovery.js";
import { mountMcp } from "./mcp-server.js";
import { mountArena } from "./arena/routes.js";
import {
  getFreePulseStore,
  wantsFreePulse,
  freePulseClientId,
  describeFreePulseRule,
} from "./free-pulse.js";
import { describePulseEligibilityRule, recordSuccessfulPulse } from "./pulse-usage.js";
import { getStore } from "./arena/index.js";
import { getReferralStore, refreshReferralProgress } from "./arena/referrals.js";

function maybeRefreshReferralAfterPulse(rec) {
  try {
    const store = getReferralStore();
    const wallets = new Set();
    if (rec?.clientId) wallets.add(String(rec.clientId).trim());
    if (rec?.payerWallet) wallets.add(String(rec.payerWallet).trim());
    const arenaStore = getStore();
    for (const w of wallets) {
      if (w && store.getBinding(w)) {
        refreshReferralProgress({ wallet: w, arenaStore });
      }
    }
  } catch (err) {
    console.error("referral progress error", String(err?.message || err));
  }
}

const payTo = resolvePayTo();
const base = publicBaseUrl();
const VERSION = "0.10.4";

const facilitatorClient = new HTTPFacilitatorClient(buildFacilitatorConfig());
// Only embed a challenge blockhash when SOLANA_RPC_URL is explicitly set.
// Default public RPC lag caused CDP verify: BlockhashNotFound for some buyers.
const svmSchemeOptions = process.env.SOLANA_RPC_URL?.trim()
  ? { rpcUrl: process.env.SOLANA_RPC_URL.trim() }
  : {};
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  CAIP2,
  new ExactSvmScheme(svmSchemeOptions),
);

// Keep bazaar output examples compact: large PAYMENT-REQUIRED bodies get echoed
// into paymentPayload.extensions and can trip facilitator schema/size checks.
const pulseOutputExample = {
  service: "crypto-pulse-api",
  generatedAt: "2026-10-30T13:00:00.000Z",
  summary:
    "Fear & Greed 30 (Fear); BTC $77.0k (-1.2% 24h), ETH $2.20k (+0.5% 24h), SOL $96.00 (+2.1% 24h); perp funding neutral; DeFi TVL $84.00B.",
  signals: {
    sentiment: "Fear",
    sentimentValue: 30,
    fundingBias: "neutral",
    fundingAvg: 0.00001,
    sourcesOk: { spots: true, fearAndGreed: true, funding: true, defi: true },
  },
  spotPrices: {
    ok: true,
    usd: { BTC: 77000, ETH: 2200, SOL: 96, SUI: 1.2, HYPE: 90, ZEC: 400 },
    change24hPct: { BTC: -1.2, ETH: 0.5, SOL: 2.1, SUI: 0.4, HYPE: -0.8, ZEC: 1.5 },
  },
  fearAndGreed: { ok: true, value: 30, classification: "Fear" },
  hyperliquidFunding: {
    ok: true,
    rates: {
      BTC: { funding: 0.00001, markPx: 77000, openInterest: 12000 },
      ETH: { funding: -0.000005, markPx: 2200, openInterest: 8000 },
      SOL: { funding: 0.00002, markPx: 96, openInterest: 4000 },
      SUI: { funding: 0.00001, markPx: 1.2, openInterest: 1500 },
      HYPE: { funding: 0.00001, markPx: 90, openInterest: 2000 },
      ZEC: { funding: 0.00001, markPx: 400, openInterest: 3000 },
    },
  },
  defi: {
    ok: true,
    totalTvlUsd: 84000000000,
    topChains: [{ name: "Ethereum", tvlUsd: 50000000000 }],
    topStableYields: [
      { project: "example", symbol: "USDC", chain: "Solana", apy: 5, tvlUsd: 1e7 },
    ],
  },
  cache: { hit: false, ttlSeconds: 60 },
};

const bazaarPulse = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {},
    additionalProperties: false,
  },
  output: {
    example: pulseOutputExample,
    schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Always crypto-pulse-api" },
        generatedAt: { type: "string", description: "ISO timestamp" },
        summary: {
          type: "string",
          description:
            "Plain-English one-liner derived from returned fields (Fear & Greed, spots, funding bias, DeFi TVL)",
        },
        signals: {
          type: "object",
          description: "Deterministic sentiment label + funding bias from the same data",
        },
        spotPrices: {
          type: "object",
          description: "BTC/ETH/SOL/SUI/HYPE/ZEC/ZEC USD + 24h % change from CoinGecko",
        },
        fearAndGreed: {
          type: "object",
          description: "Crypto Fear & Greed index 0-100 + classification",
        },
        hyperliquidFunding: {
          type: "object",
          description: "Perp funding, markPx, openInterest for BTC/ETH/SOL/SUI/HYPE/ZEC/ZEC",
        },
        defi: {
          type: "object",
          description: "DefiLlama total TVL, top chains, top stablecoin yields",
        },
        cache: { type: "object" },
      },
      required: [
        "service",
        "generatedAt",
        "summary",
        "signals",
        "spotPrices",
        "fearAndGreed",
        "hyperliquidFunding",
        "defi",
      ],
    },
  },
});

const bazaarAsset = declareDiscoveryExtension({
  input: { asset: "BTC" },
  inputSchema: {
    properties: {
      asset: {
        type: "string",
        description: "Ticker path param: BTC, ETH, SOL, SUI, HYPE, or ZEC",
        enum: ["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"],
      },
    },
    required: ["asset"],
  },
  output: {
    example: {
      service: "crypto-pulse-api",
      asset: "BTC",
      summary: "BTC $77.0k (-1.2% 24h); funding neutral (+0.0010%/8h); Fear & Greed 30 (Fear).",
      signals: { sentiment: "Fear", sentimentValue: 30, fundingBias: "neutral" },
      spot: { usd: 77000, change24hPct: -1.2 },
      funding: { funding: 0.00001, markPx: 77000, openInterest: 12000 },
      fearAndGreed: { ok: true, value: 30, classification: "Fear" },
      defi: { ok: true, totalTvlUsd: 84000000000 },
    },
    schema: {
      type: "object",
      properties: {
        asset: { type: "string" },
        summary: { type: "string" },
        signals: { type: "object" },
        spot: { type: "object", description: "USD spot + 24h change for the asset" },
        funding: { type: "object", description: "Hyperliquid funding for the asset" },
        fearAndGreed: { type: "object" },
        defi: { type: "object" },
      },
      required: ["asset", "spot", "funding", "summary", "signals"],
    },
  },
});

const bazaarSpots = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {},
    additionalProperties: false,
  },
  output: {
    example: {
      service: "crypto-pulse-api",
      generatedAt: "2026-10-30T13:00:00.000Z",
      summary: "BTC $77.0k (-1.2% 24h), ETH $2.20k (+0.5% 24h), SOL $96.00 (+2.1% 24h), SUI $1.20 (+0.4% 24h), HYPE $90.00 (-0.8% 24h), ZEC $400.00 (+1.5% 24h).",
      signals: {
        sentiment: null,
        sentimentValue: null,
        fundingBias: "unknown",
        sourcesOk: { spots: true, fearAndGreed: false, funding: false, defi: false },
      },
      spotPrices: {
        ok: true,
        usd: { BTC: 77000, ETH: 2200, SOL: 96, SUI: 1.2, HYPE: 90, ZEC: 400 },
        change24hPct: { BTC: -1.2, ETH: 0.5, SOL: 2.1, SUI: 0.4, HYPE: -0.8, ZEC: 1.5 },
      },
    },
    schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        generatedAt: { type: "string" },
        summary: { type: "string" },
        signals: { type: "object" },
        spotPrices: {
          type: "object",
          description: "BTC/ETH/SOL/SUI/HYPE/ZEC/ZEC USD spots and 24h % change",
        },
      },
      required: ["service", "generatedAt", "spotPrices", "summary", "signals"],
    },
  },
});

const SERVICE_TAGS = tags();

const paidPulseConfig = {
  accepts: [
    {
      scheme: "exact",
      price: PRICE,
      network: CAIP2,
      payTo,
    },
  ],
  description: paymentDescription(),
  mimeType: "application/json",
  serviceName: "Crypto Pulse",
  tags: paymentTags(),
  extensions: {
    ...bazaarPulse,
  },
};

const paidAssetConfig = {
  accepts: [
    {
      scheme: "exact",
      price: PRICE,
      network: CAIP2,
      payTo,
    },
  ],
  description: paymentAssetDescription(),
  mimeType: "application/json",
  serviceName: "Crypto Pulse Asset",
  tags: paymentTags(),
  extensions: {
    ...bazaarAsset,
  },
};

const paidSpotsConfig = {
  accepts: [
    {
      scheme: "exact",
      price: SPOTS_PRICE,
      network: CAIP2,
      payTo,
    },
  ],
  description: paymentSpotsDescription(),
  mimeType: "application/json",
  serviceName: "Crypto Pulse Spots",
  tags: paymentSpotsTags(),
  extensions: {
    ...bazaarSpots,
  },
};

const app = express();
app.set("trust proxy", 1);

// JSON body for MCP (and any other JSON posts). Paid GETs are unaffected.
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many requests" },
  }),
);

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    // Never log Authorization / PAYMENT-SIGNATURE / secrets
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        ip: req.ip,
        network: NETWORK_MODE,
      }),
    );
  });
  next();
});

app.get("/", (req, res) => {
  const reqBase = publicBaseUrl(req);
  res.json({
    name: "Crypto Pulse",
    service: "crypto-pulse-api",
    status: "ok",
    mode: NETWORK_MODE,
    version: VERSION,
    description: serviceDescription(),
    shortDescription: shortDescription(),
    whyUseThis:
      "One call replaces four: spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields, with a ready-made summary line. Cheaper than chaining four single-purpose x402 endpoints when you need the full brief. Free sample at /v1/sample; MCP at /mcp.",
    baseUrl: reqBase,
    pricing: {
      fullPulse: {
        endpoint: "GET /v1/pulse",
        also: "GET /v1/pulse/:asset (BTC|ETH|SOL|SUI|HYPE|ZEC|ZEC)",
        price: PRICE,
      },
      spotsOnly: {
        endpoint: "GET /v1/spots",
        price: SPOTS_PRICE,
      },
      asset: `USDC (${USDC_MINT})`,
      network: CAIP2,
      scheme: "exact",
      payTo,
      facilitator: FACILITATOR_URL,
    },
    free: [
      "GET /",
      "GET /health",
      "GET /v1/sample",
      "GET /v1/pulse (1 free live call per client per UTC day with X-Crypto-Pulse-Free + X-Pulse-Client-Id; otherwise 402)",
      "POST /mcp",
      "GET /arena",
      "GET /arena/results",
      "GET /v1/arena/rules",
      "GET /v1/arena/round",
      "POST /v1/arena/predict",
      "GET /v1/arena/leaderboard",
      "GET /v1/arena/leaderboard/weekly",
      "GET /v1/arena/results/:roundId",
      "GET /v1/arena/history",
      "GET /v1/arena/house-bots",
      "GET /v1/arena/prize-wallet",
      "GET /llms.txt",
      "GET /.well-known/x402",
      "GET /.well-known/ai-catalog.json",
      "GET /mcp/server-card",
      "GET /openapi.json",
    ],
    paid: ["GET /v1/pulse (after free daily quota)", "GET /v1/pulse/:asset", "GET /v1/spots"],
    freePulse: describeFreePulseRule(),
    mcp: {
      url: `${reqBase}/mcp`,
      transport: "streamable-http",
      tools: [
        "get_market_sample",
        "get_market_pulse",
        "get_market_spots",
        "arena_rules",
        "arena_current_round",
        "arena_submit_prediction",
        "arena_leaderboard",
        "arena_prize_wallet",
        "arena_results",
        "arena_history",
      ],
    },
    tags: SERVICE_TAGS,
    discovery: {
      llmsTxt: `${reqBase}/llms.txt`,
      wellKnownX402: `${reqBase}/.well-known/x402`,
      aiCatalog: `${reqBase}/.well-known/ai-catalog.json`,
      mcpServerCard: `${reqBase}/mcp/server-card`,
      openapi: `${reqBase}/openapi.json`,
      sample: `${reqBase}/v1/sample`,
      mcp: `${reqBase}/mcp`,
      payaiBazaar: `${PAYAI_FACILITATOR_URL}/discovery/resources?payTo=${payTo}`,
      payaiSearch: `${PAYAI_FACILITATOR_URL}/discovery/search?query=crypto+pulse`,
      cdpBazaar: `${CDP_FACILITATOR_URL}/discovery/resources?payTo=${payTo}`,
      cdpSearch: `${CDP_FACILITATOR_URL}/discovery/search?query=crypto+pulse`,
      activeFacilitator: FACILITATOR_NAME,
    },
    arena: {
      page: `${reqBase}/arena`,
      results: `${reqBase}/arena/results`,
      rules: `${reqBase}/v1/arena/rules`,
      round: `${reqBase}/v1/arena/round`,
      predict: `${reqBase}/v1/arena/predict`,
      leaderboard: `${reqBase}/v1/arena/leaderboard`,
      history: `${reqBase}/v1/arena/history`,
      houseBots: `${reqBase}/v1/arena/house-bots`,
      note: "Free skill contest for bots. No paid entry. Sponsor prizes paid automatically on-chain from the public prize wallet while funded. official-* house bots are labeled and ineligible for prizes.",
      prizeWallet: `${reqBase}/v1/arena/prize-wallet`,
    },
    docs: {
      human: "See README.md and DEPLOY.md",
      agents: `${reqBase}/llms.txt`,
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: NETWORK_MODE,
    network: CAIP2,
    usdcMint: USDC_MINT,
    facilitator: FACILITATOR_URL,
    facilitatorName: FACILITATOR_NAME,
    useCdp: USE_CDP_FACILITATOR,
    payTo,
    mainnet: IS_MAINNET,
    prices: { pulse: PRICE, spots: SPOTS_PRICE },
    version: VERSION,
    ts: new Date().toISOString(),
  });
});

app.get("/llms.txt", (req, res) => {
  res.type("text/plain; charset=utf-8").send(buildLlmsTxt(req));
});

app.get("/.well-known/x402", (req, res) => {
  res.json(buildWellKnownX402(req));
});

app.get("/.well-known/ai-catalog.json", (req, res) => {
  res
    .type("application/ai-catalog+json")
    .set("Cache-Control", "public, max-age=3600")
    .json(buildAiCatalog(req));
});

app.get("/mcp/server-card", (req, res) => {
  res
    .type("application/mcp-server-card+json")
    .set("Cache-Control", "public, max-age=3600")
    .set("Access-Control-Allow-Origin", "*")
    .json(buildMcpServerCard(req));
});

app.get("/openapi.json", (req, res) => {
  res.json(buildOpenApi(req));
});

// Free sample — tighter per-IP limit so it cannot replace the paid live feed.
const sampleLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SAMPLE_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limited",
    message: "Sample limited to 10 requests per minute per IP. Use paid /v1/pulse for live data.",
  },
});

app.get("/v1/sample", sampleLimiter, async (_req, res) => {
  try {
    const sample = await buildSample();
    res.json(sample);
  } catch (err) {
    console.error("sample error", String(err?.message || err));
    res.status(500).json({ error: "sample_failed", message: String(err.message || err) });
  }
});

// MCP Streamable HTTP (free initialize / tools/list / get_market_sample)
mountMcp(app);

// Free Crypto Pulse Prediction Arena (no paid entry; automatic on-chain prizes while funded)
mountArena(app);

// Opt-in free daily live pulse (must run before x402 middleware).
// Bare GET /v1/pulse without free headers still reaches paymentMiddleware → 402 (Bazaar-safe).
app.get("/v1/pulse", async (req, res, next) => {
  if (!wantsFreePulse(req)) return next();
  const clientId = freePulseClientId(req);
  const store = getFreePulseStore();
  const claim = store.tryConsume({ clientId, ip: req.ip });
  if (!claim.ok) {
    if (claim.reason === "invalid_client_id") {
      return res.status(400).json({
        error: "invalid_client_id",
        message:
          "Free pulse requires header X-Pulse-Client-Id (8-128 chars: letters, digits, : _ . -) plus X-Crypto-Pulse-Free: 1.",
        freePulse: describeFreePulseRule(),
      });
    }
    if (claim.reason === "ip_client_cap") {
      return res.status(429).json({
        error: "ip_client_cap",
        message: "Too many distinct free client ids from this IP today. Use x402 payment or retry tomorrow UTC.",
        freePulse: describeFreePulseRule(),
      });
    }
    // Quota exhausted → fall through to x402 402 so facilitators/indexers still see payment required.
    res.set("X-Crypto-Pulse-Free-Remaining", "0");
    return next();
  }
  try {
    const pulse = await buildPulse();
    res.set("X-Crypto-Pulse-Free-Remaining", "0");
    res.set("X-Crypto-Pulse-Free-Day", claim.day);
    try {
      maybeRefreshReferralAfterPulse(recordSuccessfulPulse(req, { kind: "free" }));
    } catch (err) {
      console.error("pulse usage log error", String(err?.message || err));
    }
    res.json({
      ...pulse,
      billing: {
        freeDaily: true,
        day: claim.day,
        clientId: claim.clientId,
        remaining: 0,
        note: "This was your 1 free live /v1/pulse for this UTC day. Further calls need x402 payment (omit free headers to get PAYMENT-REQUIRED).",
      },
    });
  } catch (err) {
    console.error("free pulse error", String(err?.message || err));
    res.status(500).json({ error: "pulse_failed", message: String(err.message || err) });
  }
});

app.get("/v1/free-pulse", (req, res) => {
  const clientId = freePulseClientId(req);
  res.json({
    ...describeFreePulseRule(),
    status: getFreePulseStore().status({ clientId }),
    arenaPrizeEligibility: describePulseEligibilityRule(),
  });
});

app.use(
  paymentMiddleware(
    {
      "GET /v1/pulse": paidPulseConfig,
      "GET /v1/pulse/:asset": paidAssetConfig,
      "GET /v1/spots": paidSpotsConfig,
    },
    resourceServer,
  ),
);

app.get("/v1/pulse", async (req, res) => {
  try {
    const pulse = await buildPulse();
    try {
      maybeRefreshReferralAfterPulse(recordSuccessfulPulse(req, { kind: "paid" }));
    } catch (err) {
      console.error("pulse usage log error", String(err?.message || err));
    }
    res.json(pulse);
  } catch (err) {
    console.error("pulse error", String(err?.message || err));
    res.status(500).json({ error: "pulse_failed", message: String(err.message || err) });
  }
});

app.get("/v1/pulse/:asset", async (req, res) => {
  try {
    const asset = String(req.params.asset || "").toUpperCase();
    if (!["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"].includes(asset)) {
      return res.status(400).json({
        error: "invalid_asset",
        message: "asset must be one of BTC, ETH, SOL, SUI, HYPE, ZEC",
      });
    }
    const pulse = await buildPulse({ asset });
    res.json(pulse);
  } catch (err) {
    console.error("pulse asset error", String(err?.message || err));
    res.status(500).json({ error: "pulse_failed", message: String(err.message || err) });
  }
});

app.get("/v1/spots", async (_req, res) => {
  try {
    const spots = await buildSpots();
    res.json(spots);
  } catch (err) {
    console.error("spots error", String(err?.message || err));
    res.status(500).json({ error: "spots_failed", message: String(err.message || err) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      event: "listen",
      host: HOST,
      port: PORT,
      mode: NETWORK_MODE,
      network: CAIP2,
      price: PRICE,
      spotsPrice: SPOTS_PRICE,
      payTo,
      facilitator: FACILITATOR_URL,
      facilitatorName: FACILITATOR_NAME,
      useCdp: USE_CDP_FACILITATOR,
      usdcMint: USDC_MINT,
      base,
      version: VERSION,
      mcp: `${base}/mcp`,
      sample: `${base}/v1/sample`,
    }),
  );
  if (IS_MAINNET) {
    console.log(
      JSON.stringify({
        event: "mainnet_warning",
        message:
          "Mainnet mode: real USDC. Do not run paid test settles unless intentionally funded.",
      }),
    );
  }
});
