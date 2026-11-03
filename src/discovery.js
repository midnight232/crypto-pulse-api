/**
 * Free agent-facing discovery docs: llms.txt, .well-known/x402, OpenAPI.
 * Built from live config so payTo / network / price stay accurate.
 */
import {
  NETWORK_MODE,
  PRICE,
  FACILITATOR_URL,
  FACILITATOR_NAME,
  PAYAI_FACILITATOR_URL,
  CDP_FACILITATOR_URL,
  CAIP2,
  USDC_MINT,
  resolvePayTo,
} from "./config.js";

const DEFAULT_PUBLIC_BASE =
  process.env.PUBLIC_BASE_URL || "https://cryptopulseapi.com";
const SPOTS_PRICE = process.env.SPOTS_PRICE || "$0.005";

/** Hosts we will echo into discovery docs / MCP payment hints. */
const KNOWN_PUBLIC_HOSTS = new Set([
  "cryptopulseapi.com",
  "www.cryptopulseapi.com",
  "137-184-201-7.sslip.io",
]);

/**
 * Canonical public base URL.
 * When called with an Express req whose Host is a known public host, derive
 * https://<host> so sslip.io clients keep seeing sslip URLs while the new
 * domain is canonical via PUBLIC_BASE_URL / default. www → apex.
 * x402 PAYMENT-REQUIRED resource URLs already come from the request host
 * inside @x402/express, independent of this helper.
 */
export function publicBaseUrl(req) {
  const hostHeader = req?.headers?.host || req?.get?.("host");
  if (hostHeader) {
    const host = String(hostHeader).split(",")[0].trim().split(":")[0].toLowerCase();
    if (KNOWN_PUBLIC_HOSTS.has(host)) {
      const canon = host === "www.cryptopulseapi.com" ? "cryptopulseapi.com" : host;
      return `https://${canon}`;
    }
  }
  return DEFAULT_PUBLIC_BASE.replace(/\/$/, "");
}

/**
 * Long description - factual "one call replaces four" positioning.
 * Competitor singles on PayAI (2026-10-30) typically $0.001-$0.005 each;
 * chaining four would be ~$0.004-$0.02+ vs our $0.02 bundle that also includes
 * a plain-English summary. Do not invent traffic or ranking claims here.
 */
export function serviceDescription() {
  return (
    "One call replaces four crypto data fetches for AI agents: (1) BTC/ETH/SOL/HYPE " +
    "spot USD + 24h change (CoinGecko), (2) Crypto Fear & Greed (alternative.me), " +
    "(3) Hyperliquid perp funding + mark + open interest, (4) DefiLlama total TVL + " +
    "top stable yields - plus a plain-English summary line and deterministic signals. " +
    "Keyless upstreams, 60s live cache, pay-per-request USDC on Solana via x402. " +
    "Typical single-purpose x402 market tools on Solana list around $0.001-$0.005 each; " +
    "this $0.02 bundle is usually cheaper than paying four of them when you need the " +
    "full brief. Free stale sample at GET /v1/sample; MCP tools at POST /mcp."
  );
}

/**
 * Description embedded in x402 PAYMENT-REQUIRED / paymentPayload.resource.
 * Coinbase CDP verify rejects paymentPayload when resource.description is >500 chars
 * (SCHEMA: must match x402V2Pay...). Keep <=480 for margin. Full copy stays in
 * serviceDescription() for free discovery docs.
 */
export function paymentDescription() {
  return (
    "One call replaces four for AI agents: CoinGecko BTC/ETH/SOL/HYPE spots + 24h change, " +
    "Fear & Greed, Hyperliquid funding/mark/OI, DefiLlama TVL/yields, plus a plain-English " +
    "summary and signals. Keyless upstreams, 60s live cache, x402 USDC on Solana. " +
    "Free sample GET /v1/sample; MCP POST /mcp."
  );
}

export function paymentSpotsDescription() {
  return (
    "Cheap BTC/ETH/SOL/HYPE USD spots + 24h change from CoinGecko, with summary. " +
    "Use /v1/pulse when you also need Fear & Greed, funding, or DeFi (one call replaces four)."
  );
}

export function paymentAssetDescription() {
  return (
    "Single-asset crypto pulse (BTC, ETH, SOL, or HYPE): spot + 24h change, Hyperliquid " +
    "funding/mark/OI, plus Fear & Greed and DefiLlama context, with summary. Prefer /v1/pulse " +
    "for all four majors in one call."
  );
}

export function shortDescription() {
  return (
    "One call replaces four: spots + Fear & Greed + Hyperliquid funding + DefiLlama " +
    "TVL/yields, with a ready-made summary. x402 USDC on Solana. Free sample + MCP."
  );
}

export function tags() {
  return [
    "crypto",
    "market-data",
    "solana",
    "agents",
    "x402",
    "fear-greed",
    "funding",
    "defi",
    "hyperliquid",
    "coingecko",
    "defillama",
    "btc",
    "eth",
    "sol",
    "mcp",
    "summary",
  ];
}

/**
 * Tags embedded in x402 PAYMENT-REQUIRED / paymentPayload resource info.
 * x402 ResourceInfoSchema: max 5 tags, each 1-32 printable ASCII.
 * Keep discovery-oriented free docs on tags() (unlimited); payment path must stay <=5
 * or CDP verify rejects the paymentPayload ("must match one of [x402V2Pay...]").
 */
export function paymentTags() {
  return ["crypto", "market-data", "solana", "agents", "x402"];
}

/** Spots paid-route tags (also <=5). */
export function paymentSpotsTags() {
  return ["crypto", "spot-price", "solana", "agents", "x402"];
}

/** Micro-units helper for well-known (USDC 6 decimals). */
function usdToAtomic(priceStr) {
  const n = Number(String(priceStr).replace(/^\$/, ""));
  if (!Number.isFinite(n)) return "20000";
  return String(Math.round(n * 1e6));
}

export function buildLlmsTxt(req) {
  const base = publicBaseUrl(req);
  const payTo = resolvePayTo();
  return `# Crypto Pulse

> ${serviceDescription()}

## Why agents pick this

- **One call replaces four** separate market APIs (spots, Fear & Greed, funding, DeFi TVL/yields).
- Every paid and sample response includes a plain-English \`summary\` line plus a \`signals\` object (sentiment, funding bias) derived from the same numbers - no extra parsing step.
- Free \`GET /v1/sample\` lets you test the schema before paying (data may be up to 15 minutes old; rate-limited).
- MCP: \`POST ${base}/mcp\` (Streamable HTTP) with tools \`get_market_sample\` (free), \`get_market_pulse\` / \`get_market_spots\` (return x402 payment requirements + HTTP URLs), plus free Arena tools \`arena_rules\`, \`arena_current_round\`, \`arena_submit_prediction\`, \`arena_leaderboard\`.

## Free endpoints (no payment)

- [Root](${base}/): service summary JSON for agents
- [Health](${base}/health): liveness + network + payTo
- [Sample](${base}/v1/sample): stale full-pulse shape + summary (≤15 min old; 10 req/min/IP)
- [MCP](${base}/mcp): Streamable HTTP MCP (POST JSON-RPC)
- [Arena](${base}/arena): FREE Crypto Pulse Prediction Arena (BTC/ETH/SOL skill contest; no paid entry)
- [Arena rules](${base}/v1/arena/rules): machine-readable arena rules + signing format
- [Prize wallet](${base}/v1/arena/prize-wallet): public address, USDC/SOL balances, payout history + Solscan links
- [OpenAPI](${base}/openapi.json): machine-readable API spec
- [x402 well-known](${base}/.well-known/x402): static paid-resource index
- [AI catalog](${base}/.well-known/ai-catalog.json): MCP Server Card discovery (SEP-2127)
- [MCP server card](${base}/mcp/server-card): connection metadata for agents
- [This file](${base}/llms.txt)

## Paid endpoints (x402 exact USDC on Solana mainnet)

- [Full pulse](${base}/v1/pulse): GET - spots + Fear & Greed + Hyperliquid funding + DefiLlama + summary. **${PRICE}** USDC
- [Single asset](${base}/v1/pulse/{asset}): GET - same sources sliced to BTC|ETH|SOL|HYPE. **${PRICE}** USDC
- [Spots only](${base}/v1/spots): GET - BTC/ETH/SOL/HYPE USD + 24h change + summary. **${SPOTS_PRICE}** USDC

## How to pay

1. \`GET\` a paid URL without payment → HTTP **402** with \`PAYMENT-REQUIRED\` (x402 v2).
2. Pay the \`exact\` requirement in USDC on network \`${CAIP2}\` to \`${payTo}\`.
3. Retry with the payment proof header. Facilitator: ${FACILITATOR_URL} (covers Solana fees).
4. No API key, no account, no subscription.

## Discovery

- Active facilitator: ${FACILITATOR_NAME} (\`${FACILITATOR_URL}\`)
- PayAI Bazaar: \`GET ${PAYAI_FACILITATOR_URL}/discovery/resources?payTo=${payTo}\`
- PayAI search: \`GET ${PAYAI_FACILITATOR_URL}/discovery/search?query=crypto+pulse\`
- CDP Bazaar: \`GET ${CDP_FACILITATOR_URL}/discovery/resources?payTo=${payTo}\`
- CDP search: \`GET ${CDP_FACILITATOR_URL}/discovery/search?query=crypto+pulse\`

## Prediction Arena (FREE — no payment, no wagering)

Skill contest for bots: predict BTC, ETH, and SOL USD at the next UTC midnight close.

- Page: [Arena](${base}/arena)
- Rules: [GET /v1/arena/rules](${base}/v1/arena/rules)
- Current round: [GET /v1/arena/round](${base}/v1/arena/round)
- Submit: [POST /v1/arena/predict](${base}/v1/arena/predict) (signed ed25519; server never receives private keys)
- Daily board: [GET /v1/arena/leaderboard](${base}/v1/arena/leaderboard)
- Weekly board: [GET /v1/arena/leaderboard/weekly](${base}/v1/arena/leaderboard/weekly)
- Sample bot: https://github.com/midnight232/crypto-pulse-api/tree/master/examples/arena-bot

Rules (truthful): free entry, no purchase necessary, no wagering. One prediction per wallet per asset per round; updates allowed until cutoff (12h before close). Ranked by average absolute % error vs CoinGecko closing spot (lower is better). Ranking requires all three assets. Sponsor-funded prizes paid **automatically on-chain** from the public prize wallet while funded: **$1 USDC daily** to #1, **$10 USDC weekly** to the best average over Mon–Sun UTC among bots that entered at least 5 of 7 rounds (program window: daily rounds 2026-11-03..2026-11-16; weekly 2026-11-02 and 2026-11-09). Insufficient balance is recorded as unpaid/owed. Kill switch: ARENA_AUTOPAY=off. If no eligible entry, no prize. Prize wallet status: GET /v1/arena/prize-wallet.

MCP Arena tools (all free): \`arena_rules\`, \`arena_current_round\`, \`arena_submit_prediction\`, \`arena_leaderboard\`, \`arena_prize_wallet\`.

## Notes for agents

- Response is JSON. Partial upstream failures are isolated (\`ok: false\` per section).
- Live cache TTL is 60 seconds on the full pulse; sample TTL is 15 minutes.
- \`summary\` and \`signals\` are derived only from returned fields - never invented.
- Not financial advice. Market data only.
- Agent discovery: \`GET ${base}/.well-known/ai-catalog.json\` and \`GET ${base}/mcp/server-card\`.
`;
}

export function buildWellKnownX402(req) {
  const base = publicBaseUrl(req);
  const payTo = resolvePayTo();
  return {
    x402Version: 2,
    name: "Crypto Pulse",
    description: shortDescription(),
    website: base,
    facilitator: FACILITATOR_URL,
    network: CAIP2,
    asset: USDC_MINT,
    assetSymbol: "USDC",
    payTo,
    mode: NETWORK_MODE,
    tags: tags(),
    mcp: `${base}/mcp`,
    sample: `${base}/v1/sample`,
    resources: [
      {
        url: `${base}/v1/pulse`,
        method: "GET",
        description: serviceDescription(),
        network: CAIP2,
        asset: USDC_MINT,
        amount: usdToAtomic(PRICE),
        price: PRICE,
        payTo,
        tags: tags(),
      },
      {
        url: `${base}/v1/pulse/{asset}`,
        method: "GET",
        description:
          "Single-asset slice (BTC, ETH, SOL, or HYPE): spot + 24h change + Hyperliquid funding, plus full Fear & Greed and DefiLlama context, with summary.",
        network: CAIP2,
        asset: USDC_MINT,
        amount: usdToAtomic(PRICE),
        price: PRICE,
        payTo,
        tags: tags(),
      },
      {
        url: `${base}/v1/spots`,
        method: "GET",
        description:
          "Cheap BTC/ETH/SOL/HYPE USD spot prices and 24h % change from CoinGecko, with summary. Use /v1/pulse when you also need Fear & Greed, funding, or DeFi yields (one call replaces four).",
        network: CAIP2,
        asset: USDC_MINT,
        amount: usdToAtomic(SPOTS_PRICE),
        price: SPOTS_PRICE,
        payTo,
        tags: ["crypto", "spot-price", "coingecko", "solana", "agents", "x402", "summary"],
      },
    ],
    free: [
      { url: `${base}/`, method: "GET" },
      { url: `${base}/health`, method: "GET" },
      { url: `${base}/v1/sample`, method: "GET", note: "Stale full-pulse sample ≤15 min" },
      { url: `${base}/mcp`, method: "POST", note: "Streamable HTTP MCP" },
      { url: `${base}/arena`, method: "GET", note: "Free prediction arena page" },
      { url: `${base}/v1/arena/rules`, method: "GET" },
      { url: `${base}/v1/arena/round`, method: "GET" },
      { url: `${base}/v1/arena/predict`, method: "POST", note: "Signed free prediction" },
      { url: `${base}/v1/arena/leaderboard`, method: "GET" },
      { url: `${base}/v1/arena/leaderboard/weekly`, method: "GET", note: "Weekly Mon–Sun UTC leaderboard" },
      { url: `${base}/openapi.json`, method: "GET" },
      { url: `${base}/llms.txt`, method: "GET" },
      { url: `${base}/.well-known/x402`, method: "GET" },
      { url: `${base}/.well-known/ai-catalog.json`, method: "GET", note: "MCP AI Catalog (SEP-2127)" },
      { url: `${base}/mcp/server-card`, method: "GET", note: "MCP Server Card" },
    ],
  };
}

export function buildOpenApi(req) {
  const base = publicBaseUrl(req);
  const payTo = resolvePayTo();
  return {
    openapi: "3.1.0",
    info: {
      title: "Crypto Pulse API",
      version: "0.6.0",
      description: serviceDescription(),
      contact: { url: base },
    },
    servers: [{ url: base }],
    paths: {
      "/": {
        get: {
          summary: "Service summary",
          operationId: "root",
          responses: {
            "200": {
              description: "Agent-oriented service description",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/health": {
        get: {
          summary: "Health check",
          operationId: "health",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/sample": {
        get: {
          summary: "Free stale sample of the full pulse",
          description:
            "Same JSON shape as /v1/pulse including summary/signals, but data may be up to 15 minutes old. Rate-limited (10/min/IP). Not a substitute for the paid live feed.",
          operationId: "getSample",
          responses: {
            "200": {
              description: "Sample pulse JSON",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Pulse" } } },
            },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/mcp": {
        post: {
          summary: "MCP Streamable HTTP endpoint",
          description:
            "JSON-RPC MCP (initialize, tools/list, tools/call). Tools: get_market_sample (free), get_market_pulse / get_market_spots (x402 payment hints), arena_rules / arena_current_round / arena_submit_prediction / arena_leaderboard (free).",
          operationId: "mcp",
          responses: {
            "200": { description: "JSON-RPC response" },
          },
        },
      },
      "/llms.txt": {
        get: {
          summary: "llms.txt discovery",
          operationId: "llmsTxt",
          responses: { "200": { description: "Markdown for agents" } },
        },
      },
      "/.well-known/x402": {
        get: {
          summary: "x402 well-known index",
          operationId: "wellKnownX402",
          responses: {
            "200": {
              description: "Static paid resource index",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This OpenAPI document",
          operationId: "openapi",
          responses: {
            "200": {
              description: "OpenAPI 3.1",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/pulse": {
        get: {
          summary: "Full crypto market pulse (one call replaces four)",
          description: serviceDescription(),
          operationId: "getPulse",
          "x-x402": {
            price: PRICE,
            network: CAIP2,
            asset: USDC_MINT,
            payTo,
            scheme: "exact",
            facilitator: FACILITATOR_URL,
          },
          responses: {
            "200": {
              description: "Pulse JSON after payment (includes summary + signals)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Pulse" } } },
            },
            "402": { description: "Payment Required (x402)" },
          },
        },
      },
      "/v1/pulse/{asset}": {
        get: {
          summary: "Single-asset pulse slice",
          operationId: "getPulseAsset",
          parameters: [
            {
              name: "asset",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["BTC", "ETH", "SOL", "HYPE"] },
              description: "Ticker",
            },
          ],
          "x-x402": {
            price: PRICE,
            network: CAIP2,
            asset: USDC_MINT,
            payTo,
            scheme: "exact",
            facilitator: FACILITATOR_URL,
          },
          responses: {
            "200": {
              description: "Asset slice JSON after payment",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AssetPulse" } } },
            },
            "402": { description: "Payment Required (x402)" },
          },
        },
      },
      "/v1/spots": {
        get: {
          summary: "Spot prices only (cheaper)",
          description:
            "BTC/ETH/SOL/HYPE USD spots and 24h change from CoinGecko + summary. Prefer /v1/pulse (one call replaces four) for funding, Fear & Greed, and DeFi.",
          operationId: "getSpots",
          "x-x402": {
            price: SPOTS_PRICE,
            network: CAIP2,
            asset: USDC_MINT,
            payTo,
            scheme: "exact",
            facilitator: FACILITATOR_URL,
          },
          responses: {
            "200": {
              description: "Spots JSON after payment",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Spots" } } },
            },
            "402": { description: "Payment Required (x402)" },
          },
        },
      },
      "/arena": {
        get: {
          summary: "Crypto Pulse Prediction Arena (HTML)",
          operationId: "arenaPage",
          responses: { "200": { description: "Human-readable arena page" } },
        },
      },
      "/v1/arena/rules": {
        get: {
          summary: "Arena rules + signing format",
          description:
            "Free entry. No wagering. Daily BTC/ETH/SOL close predictions. Scoring by average abs % error vs CoinGecko. Sponsor prizes $1 USDC daily / $10 USDC weekly paid automatically on-chain while funded.",
          operationId: "arenaRules",
          responses: {
            "200": {
              description: "Rules JSON",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/arena/round": {
        get: {
          summary: "Current or specific arena round",
          operationId: "arenaRound",
          parameters: [
            {
              name: "round",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Round id YYYY-MM-DD (settlement midnight UTC)",
            },
          ],
          responses: {
            "200": {
              description: "Round timing, entry counts, top of board",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/arena/predict": {
        post: {
          summary: "Submit or update a signed prediction (free)",
          description:
            "Body: roundId, wallet, asset (BTC|ETH|SOL), price, signature (base58 ed25519), optional botName. Server never receives private keys.",
          operationId: "arenaPredict",
          responses: {
            "200": { description: "Updated prediction" },
            "201": { description: "Created prediction" },
            "400": { description: "Validation / signature / cutoff error" },
          },
        },
      },
      "/v1/arena/leaderboard": {
        get: {
          summary: "Daily arena leaderboard",
          operationId: "arenaLeaderboard",
          parameters: [
            {
              name: "round",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Leaderboard JSON",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/arena/leaderboard/weekly": {
        get: {
          summary: "Weekly arena leaderboard (Mon–Sun UTC)",
          operationId: "arenaLeaderboardWeekly",
          parameters: [
            {
              name: "week",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Week id = Monday YYYY-MM-DD UTC",
            },
          ],
          responses: {
            "200": {
              description: "Weekly leaderboard JSON",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/.well-known/ai-catalog.json": {
        get: {
          summary: "AI Catalog (MCP Server Card discovery)",
          operationId: "aiCatalog",
          responses: {
            "200": {
              description: "AI Catalog JSON",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/mcp/server-card": {
        get: {
          summary: "MCP Server Card",
          operationId: "mcpServerCard",
          responses: {
            "200": {
              description: "MCP Server Card JSON",
              content: {
                "application/mcp-server-card+json": { schema: { type: "object" } },
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pulse: {
          type: "object",
          properties: {
            service: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            summary: {
              type: "string",
              description: "Plain-English one-liner derived from the returned fields",
            },
            signals: {
              type: "object",
              description: "Deterministic sentiment / funding bias flags",
            },
            spotPrices: { type: "object" },
            fearAndGreed: { type: "object" },
            hyperliquidFunding: { type: "object" },
            defi: { type: "object" },
            cache: { type: "object" },
            sample: { type: "boolean" },
            dataAgeSeconds: { type: "integer" },
          },
        },
        AssetPulse: {
          type: "object",
          properties: {
            asset: { type: "string" },
            summary: { type: "string" },
            signals: { type: "object" },
            spot: { type: "object" },
            funding: { type: "object" },
            fearAndGreed: { type: "object" },
            defi: { type: "object" },
          },
        },
        Spots: {
          type: "object",
          properties: {
            service: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            summary: { type: "string" },
            signals: { type: "object" },
            spotPrices: { type: "object" },
          },
        },
      },
    },
  };
}

export function buildMcpServerCard(req) {
  const base = publicBaseUrl(req);
  return {
    name: "io.github.midnight232/crypto-pulse",
    title: "Crypto Pulse",
    description:
      "Paid crypto market pulse for AI agents (spots + Fear & Greed + funding + DefiLlama + summary via x402 USDC on Solana) plus a free BTC/ETH/SOL Prediction Arena. Free sample and free Arena MCP tools.",
    version: "0.6.0",
    websiteUrl: base,
    repository: {
      url: "https://github.com/midnight232/crypto-pulse-api",
      source: "github",
    },
    remotes: [
      {
        type: "streamable-http",
        url: `${base}/mcp`,
      },
    ],
    transport: {
      type: "streamable-http",
      url: `${base}/mcp`,
    },
    freeTools: [
      "get_market_sample",
      "arena_rules",
      "arena_current_round",
      "arena_submit_prediction",
      "arena_leaderboard",
      "arena_prize_wallet",
    ],
    paidToolsHint: ["get_market_pulse", "get_market_spots"],
    arena: {
      page: `${base}/arena`,
      rules: `${base}/v1/arena/rules`,
      predict: `${base}/v1/arena/predict`,
      freeEntry: true,
      prizes: "Daily $1 USDC · Weekly $10 USDC (automatic on-chain while funded)",
    },
    documentation: {
      llmsTxt: `${base}/llms.txt`,
      openapi: `${base}/openapi.json`,
      wellKnownX402: `${base}/.well-known/x402`,
      sampleBot:
        "https://github.com/midnight232/crypto-pulse-api/tree/master/examples/arena-bot",
    },
  };
}

export function buildAiCatalog(req) {
  const base = publicBaseUrl(req);
  return {
    specVersion: "1.0",
    entries: [
      {
        identifier: "urn:air:cryptopulseapi.com:mcp:crypto-pulse",
        type: "application/mcp-server-card+json",
        url: `${base}/mcp/server-card`,
      },
    ],
  };
}


export { SPOTS_PRICE };
