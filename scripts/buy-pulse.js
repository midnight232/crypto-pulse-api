/**
 * Buyer smoke: unpaid GET -> 402, then x402-paid GET -> 200 + JSON.
 * Prints payment settlement / tx signature when available. Never prints private keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner } from "@x402/svm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:4021";
const PATH = process.env.PULSE_PATH || "/v1/pulse";

function loadBuyerSecret() {
  if (process.env.BUYER_SECRET_KEY_BASE58) {
    return process.env.BUYER_SECRET_KEY_BASE58.trim();
  }
  const p = path.join(ROOT, ".devnet-keys", "buyer.env");
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^SECRET_KEY_BASE58=(.+)$/m);
  if (!m) throw new Error("buyer.env missing SECRET_KEY_BASE58");
  return m[1].trim();
}

function loadBuyerAddress() {
  const candidates = [];
  if (process.env.NETWORK === "mainnet" || /sslip\.io|mainnet/i.test(BASE)) {
    candidates.push(path.join(ROOT, ".mainnet-keys", "buyer.env"));
  }
  candidates.push(path.join(ROOT, ".devnet-keys", "buyer.env"));
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const addr = text.match(/^ADDRESS=(.+)$/m)?.[1]?.trim();
    if (addr) return addr;
  }
  return undefined;
}

function explorerTx(sig) {
  const mainnet =
    process.env.NETWORK === "mainnet" ||
    /sslip\.io|mainnet/i.test(BASE) ||
    process.env.CLUSTER === "mainnet";
  return mainnet
    ? `https://explorer.solana.com/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function extractTxSig(headerObj) {
  if (!headerObj || typeof headerObj !== "object") return null;
  const candidates = [
    headerObj.transaction,
    headerObj.txHash,
    headerObj.transactionHash,
    headerObj.signature,
    headerObj?.settleResponse?.transaction,
    headerObj?.payer?.transaction,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 40) return c;
  }
  // deep search
  const json = JSON.stringify(headerObj);
  const m = json.match(/"transaction"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{60,})"/);
  return m?.[1] || null;
}

console.log("Buyer address:", loadBuyerAddress());
console.log("Target:", BASE + PATH);

// 1) Unpaid probe
const unpaid = await fetch(BASE + PATH);
console.log("\n=== Unpaid request ===");
console.log("status", unpaid.status);
const payReq = unpaid.headers.get("PAYMENT-REQUIRED") || unpaid.headers.get("payment-required");
console.log("PAYMENT-REQUIRED present:", Boolean(payReq));
if (payReq) {
  try {
    const decoded = Buffer.from(payReq, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    console.log(
      "requirements summary:",
      JSON.stringify(
        {
          x402Version: parsed.x402Version,
          accepts: (parsed.accepts || []).map((a) => ({
            scheme: a.scheme,
            network: a.network,
            amount: a.amount,
            asset: a.asset,
            payTo: a.payTo,
            price: a.maxAmountRequired || a.price,
          })),
        },
        null,
        2,
      ),
    );
  } catch {
    console.log("PAYMENT-REQUIRED (raw prefix):", payReq.slice(0, 120));
  }
}
if (unpaid.status !== 402) {
  const body = await unpaid.text();
  console.error("Expected 402 unpaid; body:", body.slice(0, 500));
  process.exit(1);
}

// 2) Paid request via x402 client
const secret = loadBuyerSecret();
const keypair = await createKeyPairSignerFromBytes(base58.decode(secret));
const signer = toClientSvmSigner(keypair);
const client = new x402Client();
client.register("solana:*", new ExactSvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

console.log("\n=== Paid request (x402) ===");
let response;
try {
  response = await fetchWithPayment(BASE + PATH, { method: "GET" });
} catch (e) {
  console.error("Paid request failed:", e.message || e);
  console.error(
    "Likely cause: buyer lacks DEVNET USDC. Circle faucet is not scriptable (captcha). Fund manually at https://faucet.circle.com/ then re-run.",
  );
  process.exit(2);
}

const result = await httpClient.processResponse(response);
console.log("status", response.status);
console.log("paymentStatus", result.paymentStatus);

const sig = extractTxSig(result.header) || extractTxSig(result);
if (sig) {
  console.log("transaction", sig);
  console.log("explorer", explorerTx(sig));
} else if (result.header) {
  console.log("payment header keys:", Object.keys(result.header));
  console.log("payment header (trimmed):", JSON.stringify(result.header).slice(0, 800));
}

if (response.status === 200 && result.body) {
  const body =
    typeof result.body === "string" ? JSON.parse(result.body) : result.body;
  const trimmed = {
    service: body.service,
    generatedAt: body.generatedAt,
    spotPrices: body.spotPrices?.ok
      ? { ok: true, usd: body.spotPrices.usd, source: body.spotPrices.source }
      : body.spotPrices,
    fearAndGreed: body.fearAndGreed?.ok
      ? {
          ok: true,
          value: body.fearAndGreed.value,
          classification: body.fearAndGreed.classification,
        }
      : body.fearAndGreed,
    hyperliquidFunding: body.hyperliquidFunding?.ok
      ? { ok: true, rates: body.hyperliquidFunding.rates }
      : body.hyperliquidFunding,
    defi: body.defi?.ok
      ? {
          ok: true,
          totalTvlUsd: body.defi.totalTvlUsd,
          topStableYields: body.defi.topStableYields,
        }
      : body.defi,
  };
  console.log("\n=== Pulse JSON (trimmed) ===");
  console.log(JSON.stringify(trimmed, null, 2));
} else {
  console.error("Unexpected paid response status", response.status);
  console.error("body", typeof result.body === "string" ? result.body.slice(0, 500) : result.body);
  const err = result.header?.error || result.body?.error;
  if (err === "invalid_exact_svm_transaction_simulation_failed") {
    console.error("BLOCKER: facilitator simulation failed — usually buyer has 0 DEVNET USDC (or missing buyer ATA).");
    console.error("Fund buyer USDC manually at https://faucet.circle.com/ (Solana Devnet), then re-run npm run buy.");
  }
  if (err === "invalid_exact_svm_recipient_ata_missing") {
    console.error("Fix: npm run ensure-atas");
  }
  process.exit(3);
}
