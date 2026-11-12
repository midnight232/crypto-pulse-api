/**
 * MCP server factory for Crypto Pulse.
 * Remote: Streamable HTTP at POST /mcp (stateless, JSON responses).
 * Tools:
 *   - get_market_sample (free) → stale sample pulse with summary
 *   - get_market_pulse / get_market_spots (paid via HTTP x402) → return
 *     payment requirements + direct URL. Full x402-over-MCP for Solana SVM
 *     is not robust in current @x402 packages (most examples target Base/EVM),
 *     so paid tools tell the agent how to pay the HTTP endpoint.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { buildSample } from "./pulse.js";
import {
  NETWORK_MODE,
  PRICE,
  CAIP2,
  USDC_MINT,
  FACILITATOR_URL,
  resolvePayTo,
} from "./config.js";
import { SPOTS_PRICE, publicBaseUrl, serviceDescription, shortDescription } from "./discovery.js";
import {
  getCurrentRound,
  getLeaderboard,
  getWeeklyLeaderboard,
  getPrizeStatus,
  getRules,
  getRoundResults,
  getArenaHistory,
  submitPrediction,
  signingHelp,
  decorateWithPrizeEligibility,
  getReferrerDashboardForRequest,
} from "./arena/index.js";
import { currentWeekId } from "./arena/prizes.js";
import { describeFreePulseRule } from "./free-pulse.js";

const VERSION = "0.10.0";

function paymentHint(kind, req) {
  const base = publicBaseUrl(req);
  const payTo = resolvePayTo();
  if (kind === "spots") {
    return {
      paymentRequired: true,
      tool: "get_market_spots",
      price: SPOTS_PRICE,
      network: CAIP2,
      asset: USDC_MINT,
      assetSymbol: "USDC",
      scheme: "exact",
      payTo,
      facilitator: FACILITATOR_URL,
      mode: NETWORK_MODE,
      http: {
        method: "GET",
        url: `${base}/v1/spots`,
        howToPay:
          "GET the URL without payment → HTTP 402 with PAYMENT-REQUIRED. Pay exact USDC on Solana, retry with PAYMENT-SIGNATURE (x402 v2). Facilitator covers Solana fees.",
      },
      freeAlternative: {
        tool: "get_market_sample",
        note: "Free sample has the same JSON shape as /v1/pulse but may be up to 15 minutes old.",
      },
      whyPay:
        "One paid spots call is cheaper than chaining four single-purpose price APIs when you only need BTC/ETH/SOL/SUI/HYPE USD. Prefer get_market_pulse ($0.02) when you also need Fear & Greed + funding + DeFi.",
    };
  }
  return {
    paymentRequired: true,
    tool: "get_market_pulse",
    price: PRICE,
    network: CAIP2,
    asset: USDC_MINT,
    assetSymbol: "USDC",
    scheme: "exact",
    payTo,
    facilitator: FACILITATOR_URL,
    mode: NETWORK_MODE,
    http: {
      method: "GET",
      url: `${base}/v1/pulse`,
      assetUrl: `${base}/v1/pulse/{asset}`,
      assetEnum: ["BTC", "ETH", "SOL", "SUI", "HYPE"],
      howToPay:
        "GET the URL without payment → HTTP 402 with PAYMENT-REQUIRED. Pay exact USDC on Solana, retry with PAYMENT-SIGNATURE (x402 v2). Facilitator covers Solana fees.",
    },
    freeAlternative: {
      tool: "get_market_sample",
      url: `${base}/v1/sample`,
      note: "Free sample has the same JSON shape but may be up to 15 minutes old.",
      freeLiveDaily: describeFreePulseRule(),
    },
    whyPay:
      "One call replaces four: CoinGecko spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields. Cheaper than chaining typical $0.001–$0.01 single-purpose x402 APIs when you need the full brief. First live /v1/pulse each UTC day can be free with opt-in headers.",
  };
}

export function createPulseMcpServer(req) {
  const server = new McpServer({
    name: "crypto-pulse",
    version: VERSION,
  });

  server.registerTool(
    "get_market_sample",
    {
      description:
        "FREE sample of the crypto market pulse (same JSON shape as paid /v1/pulse): spots, Fear & Greed, Hyperliquid funding, DefiLlama TVL/yields, plus a plain-English summary line. Data may be up to 15 minutes old. Use get_market_pulse for live paid data.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const sample = await buildSample();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(sample, null, 2),
          },
        ],
        structuredContent: sample,
      };
    },
  );

  server.registerTool(
    "get_market_pulse",
    {
      description:
        `Live full pulse (${PRICE} USDC on Solana via x402 after free quota). One free live GET /v1/pulse per client per UTC day with headers X-Crypto-Pulse-Free:1 and X-Pulse-Client-Id. Bare GET still returns HTTP 402 for x402 discovery. This MCP tool returns payment requirements + HTTP URL. Free stale preview: get_market_sample.`,
      inputSchema: {
        asset: z
          .enum(["BTC", "ETH", "SOL", "SUI", "HYPE"])
          .optional()
          .describe("Optional: request the single-asset HTTP URL instead of full pulse"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ asset } = {}) => {
      const hint = paymentHint("pulse", req);
      if (asset) {
        hint.http.url = `${publicBaseUrl(req)}/v1/pulse/${asset}`;
        hint.requestedAsset = asset;
      }
      hint.description = serviceDescription();
      hint.shortDescription = shortDescription();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(hint, null, 2),
          },
        ],
        structuredContent: hint,
      };
    },
  );

  server.registerTool(
    "get_market_spots",
    {
      description:
        `PAID live BTC/ETH/SOL/SUI/HYPE spot prices only (${SPOTS_PRICE} USDC). Returns payment requirements + HTTP URL for x402. Prefer get_market_pulse when you also need Fear & Greed, funding, or DeFi. Free preview: get_market_sample.`,
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const hint = paymentHint("spots", req);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(hint, null, 2),
          },
        ],
        structuredContent: hint,
      };
    },
  );


  server.registerTool(
    "arena_rules",
    {
      description:
        "FREE Crypto Pulse Prediction Arena rules: daily UTC close predictions (BTC/ETH/SOL through 2026-11-15; BTC/SOL/SUI/HYPE from 2026-11-16), free entry (no purchase necessary), scoring by average abs % error, sponsor-funded prizes paid automatically on-chain from the public prize wallet while funded ($1 daily / $10 weekly). From the 2026-11-13 close, prize eligibility requires at least one GET /v1/pulse call on the qualifying UTC day with X-Pulse-Client-Id (or payer wallet) equal to the payout wallet. Optional referral program: send ref (the referrer's payout wallet) on your first arena_submit_prediction; referrers earn $0.005 USDC after 3 UTC days of pulse+predict and $0.01 more on the referred bot's first paid /v1/pulse. Includes prize wallet address + recent payouts. Server never handles bot private keys.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const prize = await getPrizeStatus();
      const rules = {
        ...getRules(),
        signing: signingHelp(),
        page: `${publicBaseUrl(req)}/arena`,
        prizeWallet: prize.wallet,
        autopayEnabled: prize.autopayEnabled,
        recentPayouts: prize.recentPayouts,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(rules, null, 2) }],
        structuredContent: rules,
      };
    },
  );

  server.registerTool(
    "arena_prize_wallet",
    {
      description:
        "FREE: public prize wallet address, live USDC/SOL balances, autopay on/off, and recent payout history with Solscan links. No secrets.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const prize = await getPrizeStatus();
      return {
        content: [{ type: "text", text: JSON.stringify(prize, null, 2) }],
        structuredContent: prize,
      };
    },
  );

  server.registerTool(
    "arena_current_round",
    {
      description:
        "FREE: current Crypto Pulse Prediction Arena round timing (open/cutoff/close UTC), whether entries are accepted, entry counts, and top of leaderboard (prizeEligible reflects the /v1/pulse rule from round 2026-11-13). No payment.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const round = getCurrentRound();
      const out = { ...round, signing: signingHelp({ roundId: round.roundId }), page: `${publicBaseUrl(req)}/arena` };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    "arena_submit_prediction",
    {
      description:
        "FREE: submit or update a signed price prediction for the current (or given) arena round. Through 2026-11-15 assets are BTC, ETH, SOL; from 2026-11-16 they are BTC, SOL, SUI, HYPE. Pass a pre-signed payload — the server never receives private keys. Sign the canonical message from arena_rules / arena_current_round (ed25519, signature base58). From the 2026-11-13 close, also make a GET /v1/pulse that UTC day with X-Pulse-Client-Id set to this wallet to be prize-eligible. Optional ref (referrer's payout wallet) binds a referral on this bot's first prediction only; the binding never changes. Self-referral and house bots are rejected.",
      inputSchema: {
        roundId: z.string().describe("Round id YYYY-MM-DD (settlement midnight UTC)"),
        wallet: z.string().describe("Base58 Solana public key"),
        asset: z.enum(["BTC", "ETH", "SOL", "SUI", "HYPE"]).describe("Ticker for this round's asset set. Through 2026-11-15: BTC, ETH, SOL. From 2026-11-16: BTC, SOL, SUI, HYPE (ETH is rejected)."),
        price: z.number().positive().describe("Predicted USD spot at round close"),
        signature: z.string().describe("Base58 ed25519 signature over the canonical message"),
        botName: z.string().max(32).optional().describe("Optional display name"),
        ref: z.string().optional().describe("Optional referrer payout wallet. Bound only on this bot's first prediction; ignored later. Rejected if it equals this wallet."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = submitPrediction(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        const fail = decorateWithPrizeEligibility(
          {
            ok: false,
            error: err.code || "predict_failed",
            message: err.message,
            lifecycle: err.lifecycle,
            cutoffAt: err.cutoffAt,
          },
          { wallet: args?.wallet, botName: args?.botName, roundId: args?.roundId },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(fail, null, 2) }],
          structuredContent: fail,
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "arena_referrals",
    {
      description:
        "FREE: list bots referred by a payout wallet, their 3-day pulse+predict progress, and referral earnings (base $0.005 / bonus $0.01 USDC). Same data as GET /v1/arena/referrals?wallet=.",
      inputSchema: {
        wallet: z.string().describe("Referrer's payout wallet (Solana base58)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ wallet }) => {
      try {
        const result = getReferrerDashboardForRequest(wallet);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err) {
        const fail = { ok: false, error: err.code || "bad_request", message: err.message };
        return {
          content: [{ type: "text", text: JSON.stringify(fail, null, 2) }],
          structuredContent: fail,
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "arena_leaderboard",
    {
      description:
        "FREE: arena leaderboard. Default is the current daily round. Set weekly=true (optional week=Monday YYYY-MM-DD) for the weekly board: best average daily score among prize-eligible bots that entered at least 5 of 7 rounds Mon–Sun UTC and (from 2026-11-13) made a /v1/pulse call on at least one applicable day. Ineligible bots are still scored and shown. Daily #1 prize-eligible bot wins $1 USDC; weekly winner $10 USDC — paid automatically on-chain from the public prize wallet while funded.",
      inputSchema: {
        round: z.string().optional().describe("Optional daily round id YYYY-MM-DD"),
        weekly: z.boolean().optional().describe("If true, return the weekly leaderboard"),
        week: z.string().optional().describe("Optional week id (Monday YYYY-MM-DD UTC)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ round, weekly, week } = {}) => {
      const board = weekly
        ? getWeeklyLeaderboard(week || currentWeekId())
        : getLeaderboard(round || undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
        structuredContent: board,
      };
    },
  );


  server.registerTool(
    "arena_results",
    {
      description:
        "FREE: scored or in-progress Arena round results — CoinGecko closing prices used for scoring, every prediction with abs % error, leaderboard with house:true/eligible flags and ineligibleReason (including 'not prize-eligible: no /v1/pulse call'), prize-eligible winner, and payout status with Solscan tx links when paid.",
      inputSchema: {
        roundId: z.string().optional().describe("Round id YYYY-MM-DD (defaults to current entry round)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ roundId } = {}) => {
      const out = getRoundResults(roundId || getCurrentRound().roundId);
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    "arena_history",
    {
      description:
        "FREE: recent Arena rounds history (closes, predictions, scores, prize winners, payout status). Optional limit (default 10). For CSV use GET /v1/arena/history?format=csv.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit } = {}) => {
      const out = getArenaHistory({ limit: limit || 10, includePredictions: true });
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    },
  );

  return server;
}

/**
 * Express-compatible handlers for Streamable HTTP MCP (stateless + JSON).
 */
export function mountMcp(app) {
  const handle = async (req, res) => {
    const server = createPulseMcpServer(req);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (error) {
      console.error("mcp error", String(error?.message || error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  // JSON body for MCP posts (Express 5 may not parse by default for all paths)
  app.post("/mcp", async (req, res) => {
    await handle(req, res);
  });

  app.get("/mcp", async (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message:
          "Method not allowed. Use POST with JSON-RPC (initialize, tools/list, tools/call).",
      },
      id: null,
    });
  });

  app.delete("/mcp", async (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless MCP)." },
      id: null,
    });
  });
}
