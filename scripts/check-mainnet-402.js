/**
 * Start briefly in NETWORK=mainnet and assert unpaid /v1/pulse 402 shows Matt payTo + mainnet CAIP2 + USDC mint.
 * Does NOT settle a payment.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { USDC_MAINNET_ADDRESS, SOLANA_MAINNET_CAIP2 } from "@x402/svm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "4022";
const BASE = `http://127.0.0.1:${PORT}`;
const EXPECT_PAYTO = "37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const server = spawn("node", ["src/server.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    NETWORK: "mainnet",
    PORT,
    HOST: "127.0.0.1",
    FACILITATOR_URL:
      process.env.FACILITATOR_URL || "https://facilitator.payai.network",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
server.stdout.on("data", (d) => (log += d.toString()));
server.stderr.on("data", (d) => (log += d.toString()));

let failed = false;
try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await sleep(250);
    if (i === 39) throw new Error("server not healthy\n" + log);
  }

  const health = await (await fetch(`${BASE}/health`)).json();
  console.log("health", health);
  if (health.mode !== "mainnet") throw new Error("expected mainnet mode");
  if (health.payTo !== EXPECT_PAYTO) throw new Error("payTo mismatch");
  if (health.network !== SOLANA_MAINNET_CAIP2) throw new Error("network mismatch");
  if (health.usdcMint !== USDC_MAINNET_ADDRESS) throw new Error("mint mismatch");

  const unpaid = await fetch(`${BASE}/v1/pulse`);
  console.log("unpaid status", unpaid.status);
  if (unpaid.status !== 402) throw new Error(`expected 402 got ${unpaid.status}`);

  const hdr =
    unpaid.headers.get("PAYMENT-REQUIRED") ||
    unpaid.headers.get("payment-required");
  if (!hdr) throw new Error("missing PAYMENT-REQUIRED");
  const req = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
  const accepts = req.accepts || [];
  const a = accepts[0];
  const trimmed = {
    x402Version: req.x402Version,
    accepts: accepts.map((x) => ({
      scheme: x.scheme,
      network: x.network,
      amount: x.amount,
      asset: x.asset,
      payTo: x.payTo,
      hasBazaar: Boolean(req.extensions?.bazaar || x.extra),
    })),
    hasBazaarExtension: Boolean(req.extensions?.bazaar),
    resource: req.resource,
  };
  console.log("402 requirements (trimmed):");
  console.log(JSON.stringify(trimmed, null, 2));

  if (a.payTo !== EXPECT_PAYTO) throw new Error(`payTo ${a.payTo}`);
  if (a.network !== SOLANA_MAINNET_CAIP2) throw new Error(`network ${a.network}`);
  if (a.asset !== USDC_MAINNET_ADDRESS) throw new Error(`asset ${a.asset}`);
  if (a.amount !== "20000") throw new Error(`amount ${a.amount} (want 20000 for $0.02)`);

  // Verify facilitator /supported without paying
  const fac = await fetch("https://facilitator.payai.network/supported");
  if (!fac.ok) throw new Error("PayAI /supported failed " + fac.status);
  const supported = await fac.json();
  const solMain = (supported.kinds || []).find(
    (k) =>
      k.network === SOLANA_MAINNET_CAIP2 &&
      k.scheme === "exact" &&
      k.x402Version === 2,
  );
  if (!solMain) throw new Error("PayAI missing Solana mainnet exact v2");
  console.log("PayAI Solana mainnet exact ok, feePayer", solMain.extra?.feePayer);
  console.log("MAINNET_402_CHECK_OK");
} catch (e) {
  failed = true;
  console.error("MAINNET_402_CHECK_FAIL", e);
} finally {
  server.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
