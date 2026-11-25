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
import { describeForgeCatalog, listAssetPresets, listForgeTemplates, listSignalModules } from "./arena/forge/signals.js";
import {
  configureForgeBot,
  enterForgeBot,
  forgeConfigMessage,
  getForgeBot,
  previewForgeBot,
} from "./arena/forge/bots.js";
import { forgeXpLeaderboard, progressionDetail } from "./arena/forge/progress.js";
import { shareUrls } from "./arena/forge/cards.js";

const VERSION = "0.12.0";

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
        "One paid spots call is cheaper than chaining four single-purpose price APIs when you only need BTC/ETH/SOL/SUI/HYPE/ZEC USD. Prefer get_market_pulse ($0.02) when you also need Fear & Greed + funding + DeFi.",
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
      assetEnum: ["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"],
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
          .enum(["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"])
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
        `PAID live BTC/ETH/SOL/SUI/HYPE/ZEC spot prices only (${SPOTS_PRICE} USDC). Returns payment requirements + HTTP URL for x402. Prefer get_market_pulse when you also need Fear & Greed, funding, or DeFi. Free preview: get_market_sample.`,
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
        "FREE Crypto Pulse Prediction Arena rules: daily UTC close predictions (BTC/ETH/SOL), free entry (no purchase necessary), scoring by average abs % error, sponsor-funded prizes paid automatically on-chain from the public prize wallet while funded ($1 daily / $10 weekly). From the 2026-11-13 close through 2026-11-22, prize eligibility requires at least one GET /v1/pulse call (free or paid) on the qualifying UTC day with X-Pulse-Client-Id (or payer wallet) equal to the payout wallet. Starting with round 2026-11-23 (first daily round of the Nov 23–29 week), at least one paid call is required (GET /v1/spots at $0.005 or GET /v1/pulse at $0.02); free-tier pulse calls no longer count. Optional referral program: send ref (the referrer's payout wallet) on your first arena_submit_prediction; referrers earn $0.005 USDC after 3 UTC days of pulse+predict and $0.01 more on the referred bot's first paid /v1/pulse. Includes prize wallet address + recent payouts. Server never handles bot private keys.",
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
        "FREE: submit or update a signed price prediction for the current (or given) arena round. Assets are BTC, ETH, and SOL. Pass a pre-signed payload — the server never receives private keys. Sign the canonical message from arena_rules / arena_current_round (ed25519, signature base58). Through round 2026-11-22, also make a GET /v1/pulse that qualifying UTC day with X-Pulse-Client-Id set to this wallet to be prize-eligible (free daily headers still count). From round 2026-11-23, make at least one paid call (GET /v1/spots or GET /v1/pulse) that qualifying UTC day; free-tier pulse calls no longer count. Optional ref (referrer's payout wallet) binds a referral on this bot's first prediction only; the binding never changes. Self-referral and house bots are rejected.",
      inputSchema: {
        roundId: z.string().describe("Round id YYYY-MM-DD (settlement midnight UTC)"),
        wallet: z.string().describe("Base58 Solana public key"),
        asset: z.enum(["BTC", "ETH", "SOL"]).describe("Ticker: BTC, ETH, or SOL."),
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
        "FREE: arena leaderboard. Default is the current daily round. Set weekly=true (optional week=Monday YYYY-MM-DD) for the weekly board: best average daily score among prize-eligible bots that entered at least 5 of 7 rounds Mon–Sun UTC and were prize-eligible under the rule in force on at least one applicable day (pulse free-or-paid through the 2026-11-16–22 week; a paid call from the 2026-11-23–29 week onward). Ineligible bots are still scored and shown. Daily #1 prize-eligible bot wins $1 USDC; weekly winner $10 USDC — paid automatically on-chain from the public prize wallet while funded.",
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
        "FREE: scored or in-progress Arena round results — CoinGecko closing prices used for scoring, every prediction with abs % error, leaderboard with house:true/eligible flags and ineligibleReason (including 'not prize-eligible: no /v1/pulse call' through 2026-11-22 and 'not prize-eligible: no paid call' from 2026-11-23), prize-eligible winner, and payout status with Solscan tx links when paid.",
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

  function forgeToolError(err) {
    const fail = {
      ok: false,
      error: err.code || "forge_failed",
      message: err.message,
    };
    if (err.asset) fail.asset = err.asset;
    if (err.signMessage) fail.messageToSign = err.signMessage;
    if (err.price != null) fail.price = err.price;
    return {
      content: [{ type: "text", text: JSON.stringify(fail, null, 2) }],
      structuredContent: fail,
      isError: true,
    };
  }

  function forgeToolOk(result) {
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }

  server.registerTool(
    "forge_modules",
    {
      description:
        "FREE Pulse Forge signal modules: baseline, momentum, mean-reversion, Fear & Greed, funding fade, and DeFi yields. Quotes use a pulse snapshot and the house strategies. Non-cash. Does not change Arena prizes, autopay, or paid-call eligibility.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => forgeToolOk({ modules: listSignalModules(), catalog: describeForgeCatalog() }),
  );

  server.registerTool(
    "forge_templates",
    {
      description:
        "FREE Pulse Forge starter templates and asset presets (momentum, mean-revert, fear-greed, funding-fade, defi-yield, balanced, baseline). Weight presets only. Ranking still requires BTC, ETH, and SOL.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => forgeToolOk({ templates: listForgeTemplates(), assetPresets: listAssetPresets() }),
  );

  server.registerTool(
    "forge_config_message",
    {
      description:
        "FREE: canonical Pulse Forge config message to sign with the payout wallet (ed25519, base58). Does not save the bot. Server never receives private keys.",
      inputSchema: {
        wallet: z.string().describe("Base58 Solana payout wallet"),
        botName: z.string().max(32).describe("Display name, 1-32 chars. official- is reserved."),
        templateId: z.string().optional().describe("Starter template id. Omit when passing custom modules."),
        modules: z.array(z.object({ id: z.string(), weight: z.number() })).optional(),
        assets: z.array(z.enum(["BTC", "ETH", "SOL"])).optional(),
        assetPreset: z.enum(["all", "btc", "eth", "sol"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return forgeToolOk(forgeConfigMessage(args || {}));
      } catch (err) {
        return forgeToolError(err);
      }
    },
  );

  server.registerTool(
    "forge_configure",
    {
      description:
        "FREE: save a signed Pulse Forge bot for this payout wallet (one config per wallet). Pass the signature from forge_config_message. Does not enter the Arena and does not change prizes.",
      inputSchema: {
        wallet: z.string(),
        botName: z.string().max(32),
        signature: z.string().describe("Base58 ed25519 signature over the forge config message"),
        templateId: z.string().optional(),
        modules: z.array(z.object({ id: z.string(), weight: z.number() })).optional(),
        assets: z.array(z.enum(["BTC", "ETH", "SOL"])).optional(),
        assetPreset: z.enum(["all", "btc", "eth", "sol"]).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return forgeToolOk(configureForgeBot(args || {}));
      } catch (err) {
        return forgeToolError(err);
      }
    },
  );

  server.registerTool(
    "forge_preview",
    {
      description:
        "FREE: quote Arena close prices for a saved bot or an inline template/modules list. Pass a pulse snapshot (or normalized spots, fearGreed, funding, defi). Returns canonical messages to sign. Does not submit.",
      inputSchema: {
        wallet: z.string().optional(),
        botName: z.string().max(32).optional(),
        templateId: z.string().optional(),
        modules: z.array(z.object({ id: z.string(), weight: z.number() })).optional(),
        assets: z.array(z.enum(["BTC", "ETH", "SOL"])).optional(),
        assetPreset: z.enum(["all", "btc", "eth", "sol"]).optional(),
        roundId: z.string().optional(),
        snapshot: z.record(z.any()).describe("Pulse JSON or { spots, fearGreed, funding, defi }"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return forgeToolOk(previewForgeBot(args || {}));
      } catch (err) {
        return forgeToolError(err);
      }
    },
  );

  server.registerTool(
    "forge_enter",
    {
      description:
        "FREE: enter the current Arena round with a saved Pulse Forge bot. Sign each preview message and pass signatures by asset. Uses the existing predict path, so prize eligibility is unchanged. Optional ref binds a referral on the wallet's first prediction only.",
      inputSchema: {
        wallet: z.string(),
        roundId: z.string(),
        snapshot: z.record(z.any()),
        signatures: z.record(z.string()).describe("Map of BTC/ETH/SOL to base58 signatures"),
        ref: z.string().optional().describe("Referrer payout wallet. Bound only on the first prediction."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return forgeToolOk(enterForgeBot({ ...(args || {}), submitPrediction }));
      } catch (err) {
        return forgeToolError(err);
      }
    },
  );

  server.registerTool(
    "forge_progress",
    {
      description:
        "FREE: non-cash XP, level, accuracy streak, and badges for a payout wallet. Separate from prize rankings.",
      inputSchema: {
        wallet: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ wallet }) => {
      try {
        let bot = null;
        try {
          bot = getForgeBot(wallet);
        } catch {
          bot = null;
        }
        return forgeToolOk({ ...progressionDetail(wallet), bot });
      } catch (err) {
        return forgeToolError(err);
      }
    },
  );

  server.registerTool(
    "forge_leaderboard",
    {
      description:
        "FREE: non-cash Pulse Forge XP leaderboard. Does not change the daily or weekly prize leaderboards.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit } = {}) => forgeToolOk(forgeXpLeaderboard({ limit: limit || 50 })),
  );

  server.registerTool(
    "forge_share",
    {
      description:
        "FREE: share links and OG card URLs for a round result, including the referral code (the payout wallet).",
      inputSchema: {
        roundId: z.string(),
        wallet: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ roundId, wallet }) => {
      const urls = shareUrls({ baseUrl: publicBaseUrl(req), roundId, wallet });
      return forgeToolOk({ roundId, wallet, ...urls, progression: progressionDetail(wallet) });
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
