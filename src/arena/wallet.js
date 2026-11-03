/**
 * Prize wallet loader + public USDC/SOL balance helpers.
 * Never logs or returns secret key material.
 */
import fs from "fs";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes, createSolanaRpc, address } from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  fetchMaybeToken,
} from "@solana-program/token";
import { IS_MAINNET, SOLANA_RPC_URL, USDC_MINT } from "../config.js";

export const PRIZE_WALLET_PATH_DEFAULT = "/etc/arena-prize-wallet.json";
export const USDC_DECIMALS = 6;

export function prizeWalletConfigured() {
  return Boolean(resolvePrizeWalletAddress() || resolvePrizeWalletPathExists());
}

function resolvePrizeWalletPathExists() {
  const p = (process.env.ARENA_PRIZE_WALLET_PATH || PRIZE_WALLET_PATH_DEFAULT).trim();
  return Boolean(p && fs.existsSync(p));
}

/** Public address only (env preferred). */
export function resolvePrizeWalletAddress() {
  const fromEnv = (process.env.ARENA_PRIZE_WALLET || "").trim();
  if (fromEnv) return fromEnv;
  const p = (process.env.ARENA_PRIZE_WALLET_PATH || PRIZE_WALLET_PATH_DEFAULT).trim();
  if (!p || !fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof j.address === "string" ? j.address.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Load signer for sending. Secret from file or ARENA_PRIZE_SECRET_KEY_BASE58.
 * Never print the secret.
 */
export async function loadPrizeSigner() {
  const fromEnv = (process.env.ARENA_PRIZE_SECRET_KEY_BASE58 || "").trim();
  let secretBytes;
  if (fromEnv) {
    secretBytes = base58.decode(fromEnv);
  } else {
    const p = (process.env.ARENA_PRIZE_WALLET_PATH || PRIZE_WALLET_PATH_DEFAULT).trim();
    if (!p || !fs.existsSync(p)) {
      throw Object.assign(new Error("prize wallet secret not configured"), {
        code: "prize_wallet_missing",
      });
    }
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!j?.secretKeyBase58) {
      throw Object.assign(new Error("prize wallet file missing secretKeyBase58"), {
        code: "prize_wallet_missing",
      });
    }
    secretBytes = base58.decode(String(j.secretKeyBase58).trim());
  }
  if (secretBytes.length === 64) {
    return createKeyPairSignerFromBytes(secretBytes);
  }
  if (secretBytes.length === 32) {
    // seed only — nacl expand via kit expects 64-byte secret key
    const nacl = await import("tweetnacl");
    const kp = nacl.default.sign.keyPair.fromSeed(secretBytes);
    return createKeyPairSignerFromBytes(kp.secretKey);
  }
  throw Object.assign(new Error("prize secret must be 32 or 64 bytes"), {
    code: "prize_wallet_invalid",
  });
}

export function solanaExplorerTxUrl(signature) {
  const base = "https://solscan.io/tx/";
  return IS_MAINNET ? `${base}${signature}` : `${base}${signature}?cluster=devnet`;
}

export function solanaExplorerAddressUrl(addr) {
  const base = "https://solscan.io/account/";
  return IS_MAINNET ? `${base}${addr}` : `${base}${addr}?cluster=devnet`;
}

export function getRpc() {
  return createSolanaRpc(SOLANA_RPC_URL);
}

export async function getSolBalanceLamports(addr) {
  const rpc = getRpc();
  const { value } = await rpc.getBalance(address(addr)).send();
  return Number(value);
}

export async function getUsdcBalanceAtomic(ownerAddr) {
  const rpc = getRpc();
  const [ata] = await findAssociatedTokenPda({
    owner: address(ownerAddr),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: address(USDC_MINT),
  });
  const maybe = await fetchMaybeToken(rpc, ata);
  if (!maybe.exists) return { ata, amount: 0n, ui: 0 };
  const amount = BigInt(maybe.data.amount);
  return {
    ata,
    amount,
    ui: Number(amount) / 10 ** USDC_DECIMALS,
  };
}

/** Public snapshot for /arena and discovery (no secrets). */
export async function getPrizeWalletPublicStatus() {
  const addr = resolvePrizeWalletAddress();
  if (!addr) {
    return {
      configured: false,
      address: null,
      network: IS_MAINNET ? "mainnet" : "devnet",
      usdcMint: USDC_MINT,
      usdcBalance: null,
      solBalance: null,
      explorer: null,
    };
  }
  let usdcBalance = null;
  let solBalance = null;
  let error = null;
  try {
    const [usdc, lamports] = await Promise.all([
      getUsdcBalanceAtomic(addr),
      getSolBalanceLamports(addr),
    ]);
    usdcBalance = {
      ui: usdc.ui,
      atomic: usdc.amount.toString(),
      ata: usdc.ata,
    };
    solBalance = {
      lamports,
      sol: lamports / 1e9,
    };
  } catch (err) {
    error = String(err?.message || err);
  }
  return {
    configured: true,
    address: addr,
    network: IS_MAINNET ? "mainnet" : "devnet",
    usdcMint: USDC_MINT,
    usdcBalance,
    solBalance,
    explorer: solanaExplorerAddressUrl(addr),
    error,
  };
}
