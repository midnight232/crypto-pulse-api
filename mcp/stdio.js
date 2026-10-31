#!/usr/bin/env node
/**
 * Local stdio MCP entry for Crypto Pulse.
 * Proxies tool calls to the public HTTPS API (PUBLIC_BASE_URL).
 * Paid tools return x402 payment requirements + HTTP URLs (no private keys here).
 *
 * Usage:
 *   PUBLIC_BASE_URL=https://137-184-201-7.sslip.io node mcp/stdio.js
 *
 * Claude Desktop / Cursor example config:
 *   { "command": "node", "args": ["/path/to/crypto-pulse-api/mcp/stdio.js"],
 *     "env": { "PUBLIC_BASE_URL": "https://137-184-201-7.sslip.io" } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.PUBLIC_BASE_URL || "https://137-184-201-7.sslip.io").replace(
  /\/$/,
  "",
);
const VERSION = "0.3.0";

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

const server = new McpServer({
  name: "crypto-pulse",
  version: VERSION,
});

server.registerTool(
  "get_market_sample",
  {
    description:
      "FREE sample of the crypto market pulse from the public API (may be up to 15 minutes old). Includes summary + signals.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const { status, body } = await fetchJson("/v1/sample");
    if (status !== 200) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "sample_failed", status, body }, null, 2),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      structuredContent: body,
    };
  },
);

server.registerTool(
  "get_market_pulse",
  {
    description:
      "PAID live full pulse ($0.02 USDC on Solana via x402). Returns payment requirements and the HTTP URL — pay via x402 HTTP, then GET. Prefer get_market_sample for a free preview.",
    inputSchema: {
      asset: z
        .enum(["BTC", "ETH", "SOL", "HYPE"])
        .optional()
        .describe("Optional single-asset path"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ asset } = {}) => {
    const path = asset ? `/v1/pulse/${asset}` : "/v1/pulse";
    const { status, headers, body } = await fetchJson(path);
    const hint = {
      paymentRequired: status === 402,
      httpStatus: status,
      url: `${BASE}${path}`,
      price: "$0.02",
      paymentRequiredHeader: headers["payment-required"] || headers["PAYMENT-REQUIRED"] || null,
      body,
      howToPay:
        "Pay the exact USDC requirement on Solana mainnet, retry GET with PAYMENT-SIGNATURE (x402 v2).",
      freeAlternative: `${BASE}/v1/sample`,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(hint, null, 2) }],
      structuredContent: hint,
    };
  },
);

server.registerTool(
  "get_market_spots",
  {
    description:
      "PAID live spots only ($0.005 USDC). Returns payment requirements + HTTP URL.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const { status, headers, body } = await fetchJson("/v1/spots");
    const hint = {
      paymentRequired: status === 402,
      httpStatus: status,
      url: `${BASE}/v1/spots`,
      price: "$0.005",
      paymentRequiredHeader: headers["payment-required"] || headers["PAYMENT-SIGNATURE"] || null,
      body,
      howToPay:
        "Pay the exact USDC requirement on Solana mainnet, retry GET with PAYMENT-SIGNATURE (x402 v2).",
      freeAlternative: `${BASE}/v1/sample`,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(hint, null, 2) }],
      structuredContent: hint,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
