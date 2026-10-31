/**
 * Env-driven network config. NETWORK=devnet|mainnet
 *
 * Facilitator selection (mainnet):
 * - FACILITATOR=cdp (or FACILITATOR_URL pointing at CDP) + CDP_API_KEY_* → Coinbase CDP
 *   (required for CDP Bazaar indexing; settlements go through CDP)
 * - otherwise → PayAI (no API key), which keeps the existing PayAI listing path
 *
 * Never log or print CDP_API_KEY_SECRET / private keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_CAIP2,
  USDC_DEVNET_ADDRESS,
  USDC_MAINNET_ADDRESS,
} from "@x402/svm";
import { createFacilitatorConfig as createCdpFacilitatorConfig } from "@coinbase/x402";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..");

/** Matt's mainnet receive wallet (public). Never put private keys here. */
export const MAINNET_PAY_TO =
  process.env.MAINNET_PAY_TO ||
  "37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod";

const modeRaw = (process.env.NETWORK || "devnet").toLowerCase().trim();
if (modeRaw !== "devnet" && modeRaw !== "mainnet") {
  throw new Error(`NETWORK must be "devnet" or "mainnet", got: ${modeRaw}`);
}
export const NETWORK_MODE = modeRaw;
export const IS_MAINNET = NETWORK_MODE === "mainnet";

export const PRICE = process.env.PRICE || "$0.02";
export const PORT = Number(process.env.PORT || 4021);
export const HOST = process.env.HOST || "0.0.0.0";

export const CDP_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";
export const PAYAI_FACILITATOR_URL = "https://facilitator.payai.network";
export const X402ORG_FACILITATOR_URL = "https://x402.org/facilitator";

const envFacilitatorUrl = (process.env.FACILITATOR_URL || "").trim();
const envFacilitator = (process.env.FACILITATOR || "").toLowerCase().trim();
const hasCdpKeys = Boolean(
  process.env.CDP_API_KEY_ID?.trim() && process.env.CDP_API_KEY_SECRET?.trim(),
);

function wantsCdp() {
  if (envFacilitator === "cdp" || envFacilitator === "coinbase") return true;
  if (envFacilitatorUrl.includes("api.cdp.coinbase.com")) return true;
  return false;
}

export const USE_CDP_FACILITATOR = wantsCdp();

if (USE_CDP_FACILITATOR && !hasCdpKeys) {
  throw new Error(
    "CDP facilitator selected but CDP_API_KEY_ID / CDP_API_KEY_SECRET are missing",
  );
}

export const FACILITATOR_URL = USE_CDP_FACILITATOR
  ? CDP_FACILITATOR_URL
  : envFacilitatorUrl ||
    (IS_MAINNET ? PAYAI_FACILITATOR_URL : X402ORG_FACILITATOR_URL);

export const FACILITATOR_NAME = USE_CDP_FACILITATOR
  ? "cdp"
  : FACILITATOR_URL.includes("payai")
    ? "payai"
    : FACILITATOR_URL.includes("x402.org")
      ? "x402.org"
      : "custom";

/**
 * Full FacilitatorConfig for HTTPFacilitatorClient (url + optional CDP JWT auth).
 */
export function buildFacilitatorConfig() {
  if (USE_CDP_FACILITATOR) {
    return createCdpFacilitatorConfig(
      process.env.CDP_API_KEY_ID.trim(),
      process.env.CDP_API_KEY_SECRET.trim(),
    );
  }
  return { url: FACILITATOR_URL };
}

export const CAIP2 = IS_MAINNET ? SOLANA_MAINNET_CAIP2 : SOLANA_DEVNET_CAIP2;
export const USDC_MINT = IS_MAINNET ? USDC_MAINNET_ADDRESS : USDC_DEVNET_ADDRESS;

export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ||
  (IS_MAINNET
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");

function loadDevnetSellerAddress() {
  if (process.env.SELLER_ADDRESS) return process.env.SELLER_ADDRESS.trim();
  const envPath = path.join(ROOT, ".devnet-keys", "seller.env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "Missing seller address. Run: npm run generate-wallets  (or set SELLER_ADDRESS)",
    );
  }
  const text = fs.readFileSync(envPath, "utf8");
  const m = text.match(/^ADDRESS=(.+)$/m);
  if (!m) throw new Error("seller.env missing ADDRESS=");
  return m[1].trim();
}

export function resolvePayTo() {
  if (IS_MAINNET) {
    if (process.env.SELLER_ADDRESS) return process.env.SELLER_ADDRESS.trim();
    return MAINNET_PAY_TO;
  }
  return loadDevnetSellerAddress();
}

export const RATE_LIMIT_WINDOW_MS = Number(
  process.env.RATE_LIMIT_WINDOW_MS || 60_000,
);
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
