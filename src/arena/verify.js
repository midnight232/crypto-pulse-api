/**
 * Arena prediction signature verify (ed25519 / Solana wallets).
 * Server never handles bot private keys — clients sign offline.
 */
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ARENA_ASSETS } from "./rounds.js";

export const MESSAGE_PREFIX = "crypto-pulse-arena:v1";

const NAME_RE = /^[A-Za-z0-9 _.\-]{0,32}$/;

export function sanitizeBotName(name) {
  if (name == null || name === "") return "";
  const s = String(name).trim();
  if (!NAME_RE.test(s)) {
    throw Object.assign(new Error("botName must be 0-32 chars: letters, digits, space, _ . -"), {
      code: "invalid_bot_name",
    });
  }
  return s;
}

export function normalizePrice(price) {
  const n = typeof price === "number" ? price : Number(String(price).trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("price must be a positive finite number"), {
      code: "invalid_price",
    });
  }
  // Canonical decimal string without scientific notation for signing.
  // Keep up to 8 fraction digits; strip trailing zeros.
  let s = n.toFixed(8).replace(/\.?0+$/, "");
  if (s === "" || s === "-") s = String(n);
  return { value: Number(s), canonical: s };
}

export function normalizeAsset(asset) {
  const a = String(asset || "").toUpperCase().trim();
  if (!ARENA_ASSETS.includes(a)) {
    throw Object.assign(new Error(`asset must be one of ${ARENA_ASSETS.join(", ")}`), {
      code: "invalid_asset",
    });
  }
  return a;
}

export function normalizeWallet(wallet) {
  const w = String(wallet || "").trim();
  let bytes;
  try {
    bytes = base58.decode(w);
  } catch {
    throw Object.assign(new Error("wallet must be a base58 Solana address"), {
      code: "invalid_wallet",
    });
  }
  if (bytes.length !== 32) {
    throw Object.assign(new Error("wallet must decode to 32 bytes"), {
      code: "invalid_wallet",
    });
  }
  // Reject the Solana system program / all-zero pubkey. tweetnacl can report
  // a true verify for some signatures against the zero key, which would let
  // anyone forge entries as wallet 11111…11.
  if (bytes.every((b) => b === 0)) {
    throw Object.assign(new Error("wallet cannot be the all-zero address"), {
      code: "invalid_wallet",
    });
  }
  return { wallet: w, bytes };
}

/**
 * Canonical message bots must sign (exact bytes).
 * crypto-pulse-arena:v1|round=YYYY-MM-DD|wallet=...|asset=BTC|price=95000.5|name=MyBot
 */
export function buildCanonicalMessage({ roundId, wallet, asset, priceCanonical, botName }) {
  const name = botName || "";
  return (
    `${MESSAGE_PREFIX}|round=${roundId}|wallet=${wallet}` +
    `|asset=${asset}|price=${priceCanonical}|name=${name}`
  );
}

export function verifyPredictionSignature({
  roundId,
  wallet,
  asset,
  price,
  botName,
  signature,
}) {
  const { wallet: w, bytes: pub } = normalizeWallet(wallet);
  const a = normalizeAsset(asset);
  const { value, canonical } = normalizePrice(price);
  const name = sanitizeBotName(botName);
  const message = buildCanonicalMessage({
    roundId,
    wallet: w,
    asset: a,
    priceCanonical: canonical,
    botName: name,
  });

  let sigBytes;
  try {
    sigBytes = base58.decode(String(signature || "").trim());
  } catch {
    throw Object.assign(new Error("signature must be base58"), {
      code: "invalid_signature",
    });
  }
  if (sigBytes.length !== 64) {
    throw Object.assign(new Error("signature must decode to 64 bytes"), {
      code: "invalid_signature",
    });
  }

  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    sigBytes,
    pub,
  );
  if (!ok) {
    throw Object.assign(new Error("signature verification failed"), {
      code: "bad_signature",
    });
  }

  return {
    wallet: w,
    asset: a,
    price: value,
    priceCanonical: canonical,
    botName: name || null,
    message,
    signature: String(signature).trim(),
  };
}
