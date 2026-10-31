/**
 * Example: sign and submit a free arena prediction.
 *
 * Usage:
 *   node scripts/arena-submit.js --asset BTC --price 100000 [--name MyBot]
 *
 * Generates a throwaway keypair in-memory (or loads ARENA_SECRET_KEY_BASE58).
 * Never prints the secret key.
 *
 * Env:
 *   PUBLIC_BASE_URL  (default http://127.0.0.1:4021)
 *   ARENA_SECRET_KEY_BASE58  optional 64-byte secret key
 *   ARENA_BOT_NAME optional
 */
import nacl from "tweetnacl";
import { base58 } from "@scure/base";

const BASE = (process.env.PUBLIC_BASE_URL || "http://127.0.0.1:4021").replace(/\/$/, "");

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function loadKeypair() {
  const fromEnv = (process.env.ARENA_SECRET_KEY_BASE58 || "").trim();
  if (fromEnv) {
    const secret = base58.decode(fromEnv);
    if (secret.length === 64) return nacl.sign.keyPair.fromSecretKey(secret);
    if (secret.length === 32) return nacl.sign.keyPair.fromSeed(secret);
    throw new Error("ARENA_SECRET_KEY_BASE58 must be 32 or 64 bytes");
  }
  return nacl.sign.keyPair();
}

function canonicalPrice(n) {
  let s = Number(n).toFixed(8).replace(/\.?0+$/, "");
  return s;
}

function buildMessage({ roundId, wallet, asset, priceCanonical, botName }) {
  return (
    `crypto-pulse-arena:v1|round=${roundId}|wallet=${wallet}` +
    `|asset=${asset}|price=${priceCanonical}|name=${botName || ""}`
  );
}

const asset = String(arg("asset", "BTC")).toUpperCase();
const price = Number(arg("price", "0"));
const botName = arg("name", process.env.ARENA_BOT_NAME || "");
const roundOverride = arg("round", "");

if (!Number.isFinite(price) || price <= 0) {
  console.error("Usage: node scripts/arena-submit.js --asset BTC --price 100000 [--name MyBot]");
  process.exit(1);
}

const roundRes = await fetch(
  roundOverride ? `${BASE}/v1/arena/round?round=${roundOverride}` : `${BASE}/v1/arena/round`,
);
const roundJson = await roundRes.json();
if (!roundRes.ok) {
  console.error("Failed to fetch round", roundJson);
  process.exit(1);
}
const roundId = roundJson.roundId;
if (!roundJson.acceptingEntries) {
  console.error(`Round ${roundId} is not accepting entries (status=${roundJson.status})`);
  process.exit(1);
}

const kp = loadKeypair();
const wallet = base58.encode(kp.publicKey);
const priceCanonical = canonicalPrice(price);
const message = buildMessage({
  roundId,
  wallet,
  asset,
  priceCanonical,
  botName,
});
const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
const signature = base58.encode(sig);

const body = {
  roundId,
  wallet,
  asset,
  price: Number(priceCanonical),
  botName: botName || undefined,
  signature,
};

const res = await fetch(`${BASE}/v1/arena/predict`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(
  JSON.stringify(
    {
      status: res.status,
      wallet,
      roundId,
      asset,
      price: Number(priceCanonical),
      ok: json.ok,
      created: json.created,
      error: json.error,
      message: json.message,
    },
    null,
    2,
  ),
);
if (!res.ok) process.exit(1);
