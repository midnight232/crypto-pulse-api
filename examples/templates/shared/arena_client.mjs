/**
 * Shared Crypto Pulse Arena REST client + ed25519 signing (Node ESM).
 * Deps: tweetnacl, bs58 (or @scure/base).
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

export const DEFAULT_BASE = "https://cryptopulseapi.com";
const COINGECKO =
  "https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd";
export const ASSET_IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", SUI: "sui", HYPE: "hyperliquid" };
export const ASSETS = ["BTC", "ETH", "SOL", "SUI", "HYPE", "ZEC"];

export function getBase() {
  return (process.env.ARENA_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export function getBotName() {
  return String(process.env.ARENA_BOT_NAME || "TemplateBot").trim().slice(0, 32);
}

export async function httpJson(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "User-Agent": "crypto-pulse-arena-template/0.6",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

export function canonicalPrice(n) {
  let s = Number(n).toFixed(8).replace(/\.?0+$/, "");
  return s || "0";
}

export function buildMessage({ roundId, wallet, asset, priceCanonical, botName }) {
  return (
    `crypto-pulse-arena:v1|round=${roundId}|wallet=${wallet}` +
    `|asset=${asset}|price=${priceCanonical}|name=${botName || ""}`
  );
}

export function loadKeypair() {
  const fromEnv = (process.env.ARENA_SECRET_KEY_BASE58 || "").trim();
  if (!fromEnv) return nacl.sign.keyPair();
  const secret = bs58.decode(fromEnv);
  if (secret.length === 64) return nacl.sign.keyPair.fromSecretKey(secret);
  if (secret.length === 32) return nacl.sign.keyPair.fromSeed(secret);
  throw new Error("ARENA_SECRET_KEY_BASE58 must be 32 or 64 bytes");
}

export async function fetchSpots(assets = ASSETS) {
  const ids = assets.map((a) => ASSET_IDS[a]).filter(Boolean).join(",");
  const { status, json } = await httpJson(COINGECKO.replace("{ids}", ids));
  if (status !== 200) throw new Error(`CoinGecko ${status}`);
  const out = {};
  for (const asset of assets) {
    const id = ASSET_IDS[asset];
    const usd = json?.[id]?.usd;
    if (!(usd > 0)) throw new Error(`missing ${asset}`);
    out[asset] = Number(usd);
  }
  return out;
}

export async function fetchRound(base = getBase()) {
  const { status, json } = await httpJson(`${base}/v1/arena/round`);
  if (status !== 200) throw new Error(`round ${status}`);
  return json;
}

export async function fetchRules(base = getBase()) {
  const { status, json } = await httpJson(`${base}/v1/arena/rules`);
  if (status !== 200) throw new Error(`rules ${status}`);
  return json;
}

export async function fetchLeaderboard(base = getBase(), weekly = false) {
  const path = weekly ? "/v1/arena/leaderboard/weekly" : "/v1/arena/leaderboard";
  const { status, json } = await httpJson(`${base}${path}`);
  if (status !== 200) throw new Error(`leaderboard ${status}`);
  return json;
}

export async function fetchPrizeWallet(base = getBase()) {
  const { status, json } = await httpJson(`${base}/v1/arena/prize-wallet`);
  if (status !== 200) throw new Error(`prize-wallet ${status}`);
  return json;
}

export function buildSignedPrediction({ roundId, asset, price, keyPair, botName }) {
  const wallet = bs58.encode(keyPair.publicKey);
  const priceCanonical = canonicalPrice(price);
  const message = buildMessage({
    roundId,
    wallet,
    asset,
    priceCanonical,
    botName,
  });
  const sig = nacl.sign.detached(new TextEncoder().encode(message), keyPair.secretKey);
  return {
    roundId,
    wallet,
    asset,
    price: Number(priceCanonical),
    botName,
    signature: bs58.encode(sig),
    _message: message,
  };
}

export async function submitPrediction(body, { base = getBase(), dryRun = false } = {}) {
  const payload = Object.fromEntries(
    Object.entries(body).filter(([k]) => !k.startsWith("_")),
  );
  if (dryRun) {
    return {
      dryRun: true,
      message: body._message,
      body: { ...payload, signature: `${payload.signature.slice(0, 12)}…` },
    };
  }
  const { status, json } = await httpJson(`${base}/v1/arena/predict`, {
    method: "POST",
    body: payload,
  });
  return { httpStatus: status, ...json };
}

export async function enterNaive({ dryRun = false, assets } = {}) {
  const base = getBase();
  const botName = getBotName();
  const roundJson = await fetchRound(base);
  if (!roundJson.acceptingEntries) {
    throw new Error(
      `round ${roundJson.roundId} not accepting (status=${roundJson.status})`,
    );
  }
  const roundAssets = (roundJson.assets || ASSETS).filter((a) => ASSET_IDS[a]);
  const useAssets = assets || roundAssets;
  const spots = await fetchSpots(useAssets);
  const keyPair = loadKeypair();
  const wallet = bs58.encode(keyPair.publicKey);
  const results = [];
  for (const asset of useAssets) {
    const signed = buildSignedPrediction({
      roundId: roundJson.roundId,
      asset,
      price: spots[asset],
      keyPair,
      botName,
    });
    results.push(await submitPrediction(signed, { base, dryRun }));
  }
  return {
    base,
    roundId: roundJson.roundId,
    wallet,
    botName,
    spotsUsd: spots,
    dryRun,
    results,
  };
}
