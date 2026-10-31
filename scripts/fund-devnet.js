/**
 * Fund throwaway DEVNET wallets:
 *  - SOL via public Solana requestAirdrop (no signup)
 *  - USDC: Circle faucet is NOT scriptable without captcha/credentials — documented below
 * Never prints private keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const AIRDROP_RPC =
  process.env.AIRDROP_RPC_URL || "https://solana-devnet.g.alchemy.com/v2/demo";
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function loadAddress(role) {
  const p = path.join(ROOT, ".devnet-keys", `${role}.env`);
  const text = fs.readFileSync(p, "utf8");
  const m = text.match(/^ADDRESS=(.+)$/m);
  if (!m) throw new Error(`missing ADDRESS in ${role}.env`);
  return m[1].trim();
}

async function airdropSol(connection, address, sol = 1) {
  const pk = new PublicKey(address);
  const before = await connection.getBalance(pk);
  console.log(`${address} SOL before: ${Number(before) / LAMPORTS_PER_SOL}`);
  const lamports = sol * LAMPORTS_PER_SOL;
  const endpoints = [AIRDROP_RPC, RPC].filter((v, i, a) => a.indexOf(v) === i);
  for (const endpoint of endpoints) {
    try {
      console.log(`trying airdrop via ${endpoint}`);
      const airdropConn = new Connection(endpoint, "confirmed");
      const sig = await airdropConn.requestAirdrop(pk, lamports);
      // Confirm on public RPC (more reliable for getBalance)
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      const after = await connection.getBalance(pk);
      console.log(`airdrop ok sig=${sig}`);
      console.log(`${address} SOL after: ${Number(after) / LAMPORTS_PER_SOL}`);
      return sig;
    } catch (e) {
      console.error(`airdrop failed via ${endpoint}:`, e.message || e);
    }
  }
  return null;
}

async function tryCircleUsdc(address) {
  // Public Circle faucet UI: https://faucet.circle.com/ — requires browser captcha.
  // No documented unauthenticated drip API. Probe a few likely endpoints and report.
  const attempts = [
    {
      url: "https://api.circle.com/v1/faucet/drips",
      body: {
        address,
        blockchain: "SOL",
        native: false,
        usdc: true,
      },
    },
    {
      url: "https://faucet.circle.com/api/drip",
      body: { address, blockchain: "SOL", token: "USDC" },
    },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a.body),
      });
      const text = await res.text();
      console.log(`Circle probe ${a.url} -> HTTP ${res.status} ${text.slice(0, 160)}`);
    } catch (e) {
      console.log(`Circle probe ${a.url} -> error ${e.message}`);
    }
  }
  console.log("");
  console.log("BLOCKER: Devnet USDC cannot be obtained scriptably without signup/captcha.");
  console.log("Manual option (human, free, no account if Circle public faucet works in browser):");
  console.log(`  1. Open https://faucet.circle.com/`);
  console.log(`  2. Select Solana Devnet, paste buyer address: ${address}`);
  console.log(`  3. Request USDC (mint ${USDC_DEVNET})`);
  console.log("Until then, unpaid 402 + data smoke tests still work; paid settle needs USDC.");
}

const connection = new Connection(RPC, "confirmed");
const seller = loadAddress("seller");
const buyer = loadAddress("buyer");
console.log("RPC", RPC);
console.log("Funding seller + buyer with DEVNET SOL (airdrop)...");
await airdropSol(connection, seller, 1);
await airdropSol(connection, buyer, 1);
console.log("\nAttempting Circle USDC faucet (expected to fail without captcha)...");
await tryCircleUsdc(buyer);
