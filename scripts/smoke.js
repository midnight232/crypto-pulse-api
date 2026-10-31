/**
 * Local smoke: health + unpaid 402 + (optional) paid flow if BUY_ON_SMOKE=1.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "4031";
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const server = spawn("node", ["src/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT, NETWORK: process.env.NETWORK || "devnet", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let bootLog = "";
server.stdout.on("data", (d) => {
  bootLog += d.toString();
});
server.stderr.on("data", (d) => {
  bootLog += d.toString();
});

let failed = false;
try {
  // wait for listen
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await sleep(250);
    if (i === 39) throw new Error("server did not become healthy\n" + bootLog);
  }

  const health = await (await fetch(`${BASE}/health`)).json();
  console.log("health", health);

  const root = await (await fetch(`${BASE}/`)).json();
  console.log("root.pricing.price", root.pricing?.price);
  console.log("root.mode", root.mode);
  if (root.mode !== "devnet" && process.env.NETWORK !== "mainnet") {
    // default smoke expects devnet
  }

  const unpaid = await fetch(`${BASE}/v1/pulse`);
  console.log("unpaid status", unpaid.status);
  if (unpaid.status !== 402) {
    throw new Error(`expected 402, got ${unpaid.status}`);
  }
  console.log(
    "PAYMENT-REQUIRED header?",
    Boolean(unpaid.headers.get("PAYMENT-REQUIRED") || unpaid.headers.get("payment-required")),
  );

  // Quick data path without payment: temporarily not available through middleware.
  // Instead unit-call pulse builder:
  const { buildPulse } = await import("../src/pulse.js");
  const pulse = await buildPulse();
  console.log("pulse.spot ok?", pulse.spotPrices?.ok, "usd", pulse.spotPrices?.usd);
  console.log("fearGreed", pulse.fearAndGreed?.value, pulse.fearAndGreed?.classification);
  console.log("funding BTC", pulse.hyperliquidFunding?.rates?.BTC?.funding);
  console.log("defi totalTvlUsd", pulse.defi?.totalTvlUsd);

  if (process.env.BUY_ON_SMOKE === "1") {
    const buy = spawn("node", ["scripts/buy-pulse.js"], {
      cwd: ROOT,
      env: { ...process.env, BASE_URL: BASE },
      stdio: "inherit",
    });
    const code = await new Promise((resolve) => buy.on("close", resolve));
    if (code !== 0) {
      failed = true;
      console.error("buy-pulse exited", code);
    }
  } else {
    console.log("Skipping paid settle (set BUY_ON_SMOKE=1 after funding buyer USDC).");
  }

  console.log(failed ? "SMOKE PARTIAL/FAIL" : "SMOKE OK (unpaid + data)");
} catch (e) {
  failed = true;
  console.error("SMOKE FAIL", e);
} finally {
  server.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
