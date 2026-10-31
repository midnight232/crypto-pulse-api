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

const VERSION = "0.3.0";

function paymentHint(kind) {
  const base = publicBaseUrl();
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
        "One paid spots call is cheaper than chaining four single-purpose price APIs when you only need BTC/ETH/SOL/HYPE USD. Prefer get_market_pulse ($0.02) when you also need Fear & Greed + funding + DeFi.",
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
      assetEnum: ["BTC", "ETH", "SOL", "HYPE"],
      howToPay:
        "GET the URL without payment → HTTP 402 with PAYMENT-REQUIRED. Pay exact USDC on Solana, retry with PAYMENT-SIGNATURE (x402 v2). Facilitator covers Solana fees.",
    },
    freeAlternative: {
      tool: "get_market_sample",
      url: `${base}/v1/sample`,
      note: "Free sample has the same JSON shape but may be up to 15 minutes old.",
    },
    whyPay:
      "One call replaces four: CoinGecko spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields. Cheaper than chaining typical $0.001–$0.01 single-purpose x402 APIs when you need the full brief.",
  };
}

export function createPulseMcpServer() {
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
        `PAID live full pulse (${PRICE} USDC on Solana via x402). One call replaces four data sources (spots + Fear & Greed + Hyperliquid funding + DefiLlama). This MCP tool returns payment requirements and the HTTP URL — pay via x402 HTTP (Solana USDC), then GET the URL. For a free preview call get_market_sample first.`,
      inputSchema: {
        asset: z
          .enum(["BTC", "ETH", "SOL", "HYPE"])
          .optional()
          .describe("Optional: request the single-asset HTTP URL instead of full pulse"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ asset } = {}) => {
      const hint = paymentHint("pulse");
      if (asset) {
        hint.http.url = `${publicBaseUrl()}/v1/pulse/${asset}`;
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
        `PAID live BTC/ETH/SOL/HYPE spot prices only (${SPOTS_PRICE} USDC). Returns payment requirements + HTTP URL for x402. Prefer get_market_pulse when you also need Fear & Greed, funding, or DeFi. Free preview: get_market_sample.`,
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const hint = paymentHint("spots");
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

  return server;
}

/**
 * Express-compatible handlers for Streamable HTTP MCP (stateless + JSON).
 */
export function mountMcp(app) {
  const handle = async (req, res) => {
    const server = createPulseMcpServer();
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
