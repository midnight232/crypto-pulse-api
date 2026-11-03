#!/usr/bin/env node
/** Standalone dry-run / submit without booting full ElizaOS. */
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(__dirname, "../shared/arena_client.mjs");
const { enterNaive, fetchRules, fetchPrizeWallet } = await import(pathToFileURL(shared).href);

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
