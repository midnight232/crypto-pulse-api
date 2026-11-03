/**
 * Example: invoke the Arena Action handler with a SolanaAgentKit instance.
 * Run: node --experimental-strip-types register.mjs --dry-run
 * (Node 22+) or compile enterArenaAction.ts first.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import { enterCryptoPulseArenaAction } from "./enterArenaAction.ts";

const secret = (process.env.SOLANA_PRIVATE_KEY || "").trim();
const keypair = secret
  ? Keypair.fromSecretKey(bs58.decode(secret))
  : Keypair.generate();
const rpc = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const wallet = new KeypairWallet(keypair, rpc);
const agent = new SolanaAgentKit(wallet, rpc, {});
const result = await enterCryptoPulseArenaAction.handler(agent, {
  dryRun: process.argv.includes("--dry-run"),
});
console.log(JSON.stringify(result, null, 2));
