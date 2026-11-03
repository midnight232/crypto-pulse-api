#!/usr/bin/env node
/**
 * Dry-run / submit without requiring a funded SolanaAgentKit wallet.
 * For full kit wiring, see register.mjs + enterArenaAction.ts.
 */
import { enterNaive, fetchPrizeWallet, fetchRules } from "../shared/arena_client.mjs";

const dryRun = process.argv.includes("--dry-run") || ["1","true","yes"].includes(String(process.env.ARENA_DRY_RUN || "").toLowerCase());
const out = {
  rules: await fetchRules(),
  prizeWallet: await fetchPrizeWallet(),
  entry: await enterNaive({ dryRun }),
};
console.log(JSON.stringify(out, null, 2));
if (!dryRun) {
  const ok = out.entry.results.every((r) => r.httpStatus === 200 || r.httpStatus === 201);
  process.exit(ok ? 0 : 1);
}
