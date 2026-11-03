/**
 * Quick MCP client against a base URL (default: live).
 * Tests initialize + tools/list + get_market_sample. No paid settles.
 */
const BASE = (process.env.PUBLIC_BASE_URL || "https://cryptopulseapi.com").replace(
  /\/$/,
  "",
);
const MCP = `${BASE}/mcp`;

async function rpc(method, params, id = 1) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // SSE fallback parse: take last data: line
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    if (lines.length) {
      body = JSON.parse(lines[lines.length - 1].slice(5).trim());
    } else {
      throw new Error(`Non-JSON MCP response ${res.status}: ${text.slice(0, 400)}`);
    }
  }
  return { status: res.status, body };
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "crypto-pulse-test", version: "0.3.0" },
});
console.log("initialize status", init.status);
if (init.body.error) {
  console.error(init.body);
  process.exit(1);
}
console.log("serverInfo", init.body.result?.serverInfo);

const listed = await rpc("tools/list", {}, 2);
const tools = listed.body.result?.tools?.map((t) => t.name) || [];
console.log("tools", tools);
for (const need of [
  "get_market_sample",
  "get_market_pulse",
  "get_market_spots",
  "arena_rules",
  "arena_current_round",
  "arena_submit_prediction",
  "arena_leaderboard",
  "arena_prize_wallet",
]) {
  if (!tools.includes(need)) {
    console.error("missing tool", need, listed.body);
    process.exit(1);
  }
}

const sample = await rpc(
  "tools/call",
  { name: "get_market_sample", arguments: {} },
  3,
);
if (sample.body.error) {
  console.error("sample error", sample.body);
  process.exit(1);
}
const text = sample.body.result?.content?.[0]?.text || "";
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = sample.body.result?.structuredContent;
}
if (!parsed?.summary) {
  console.error("sample missing summary", sample.body.result);
  process.exit(1);
}
console.log("sample.summary:", parsed.summary);
console.log("sample.sample:", parsed.sample, "dataAgeSeconds:", parsed.dataAgeSeconds);
console.log("mcp ok");
