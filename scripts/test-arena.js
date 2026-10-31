/**
 * Local arena tests: sign/verify, submit, reject bad sig, leaderboard, admin delete.
 * Uses an isolated temp data file. Does not print secrets.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import {
  _setStoreForTests,
  buildCanonicalMessage,
  currentEntryRound,
  getLeaderboard,
  getCurrentRound,
  submitPrediction,
  deletePredictionAdmin,
  verifyPredictionSignature,
} from "../src/arena/index.js";
import { ArenaStore } from "../src/arena/store.js";
import { normalizePrice } from "../src/arena/verify.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-test-"));
const dbPath = path.join(tmp, "arena.json");
_setStoreForTests(new ArenaStore(dbPath));

function keypair() {
  return nacl.sign.keyPair();
}

function signAll(kp, roundId, prices, botName = "TestBot") {
  const wallet = base58.encode(kp.publicKey);
  const out = [];
  for (const [asset, price] of Object.entries(prices)) {
    const { canonical } = normalizePrice(price);
    const message = buildCanonicalMessage({
      roundId,
      wallet,
      asset,
      priceCanonical: canonical,
      botName,
    });
    const sig = base58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
    );
    out.push({ roundId, wallet, asset, price: Number(canonical), botName, signature: sig });
  }
  return out;
}

const round = currentEntryRound();
console.log("current_round", round.roundId, round.lifecycle, "cutoff", round.cutoffAt);

if (round.lifecycle !== "open") {
  console.error("FAIL: expected an open entry round");
  process.exit(1);
}

const kp = keypair();
const wallet = base58.encode(kp.publicKey);
const preds = signAll(kp, round.roundId, { BTC: 100000.5, ETH: 3500, SOL: 180.25 });

for (const p of preds) {
  const r = submitPrediction(p);
  if (!r.ok) throw new Error("submit failed");
}
console.log("submit_ok", wallet.slice(0, 8) + "…");

// Bad signature
let badOk = false;
try {
  submitPrediction({ ...preds[0], signature: base58.encode(Buffer.alloc(64)) });
  badOk = true;
} catch (err) {
  if (err.code !== "bad_signature") throw err;
  console.log("bad_signature_rejected");
}
if (badOk) throw new Error("bad signature was accepted");

// Verify helper directly
verifyPredictionSignature(preds[0]);
console.log("verify_ok");

const board = getLeaderboard(round.roundId);
if (board.ranking.length !== 1) throw new Error("expected 1 complete ranking row");
if (board.ranking[0].wallet !== wallet) throw new Error("wallet mismatch");
console.log("leaderboard_ok", board.ranking[0].rank);

const cur = getCurrentRound();
if (cur.uniqueWallets !== 1) throw new Error("uniqueWallets");
console.log("current_round_counts", cur.entryCounts);

const deleted = deletePredictionAdmin({ roundId: round.roundId, wallet });
if (!deleted) throw new Error("delete failed");
const board2 = getLeaderboard(round.roundId);
if (board2.ranking.length !== 0) throw new Error("expected empty after delete");
console.log("admin_delete_ok");

console.log("ALL_ARENA_TESTS_PASSED");
