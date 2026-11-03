/**
 * House-bot prize exclusion + free-pulse quota tests. No mainnet spend.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import { buildLeaderboard } from "../src/arena/scoring.js";
import { processAutopay } from "../src/arena/autopay.js";
import { FreePulseStore } from "../src/free-pulse.js";
import { isHouseBotName, predictForStrategy } from "../src/arena/house.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(isHouseBotName("official-baseline"), "house name");
assert(!isHouseBotName("my-bot"), "non house");

const spots = {
  BTC: { usd: 100000, change24hPct: 10 },
  ETH: { usd: 2000, change24hPct: -10 },
  SOL: { usd: 100, change24hPct: 0 },
};
assert(predictForStrategy("baseline", "BTC", spots) === 100000, "baseline");
assert(Math.abs(predictForStrategy("momentum", "BTC", spots) - 110000) < 1e-6, "mom");
assert(Math.abs(predictForStrategy("meanrevert", "ETH", spots) - 2100) < 1e-6, "mr");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "house-test-"));
const store = new ArenaStore(path.join(tmp, "arena.json"));
const roundId = "2026-11-05";
store.ensureRound({
  roundId,
  openAt: "2026-11-03T12:00:00.000Z",
  cutoffAt: "2026-11-04T12:00:00.000Z",
  closeAt: "2026-11-05T00:00:00.000Z",
});

const houseKp = nacl.sign.keyPair();
const humanKp = nacl.sign.keyPair();
const houseWallet = base58.encode(houseKp.publicKey);
const humanWallet = base58.encode(humanKp.publicKey);

for (const asset of ["BTC", "ETH", "SOL"]) {
  store.upsertPrediction(roundId, {
    wallet: houseWallet,
    botName: "official-baseline",
    asset,
    price: asset === "BTC" ? 100 : asset === "ETH" ? 1 : 1,
    house: true,
  });
  store.upsertPrediction(roundId, {
    wallet: humanWallet,
    botName: "HumanBot",
    asset,
    price: asset === "BTC" ? 100000 : asset === "ETH" ? 2000 : 100,
    house: false,
  });
}
store.applyErrors(roundId, {
  [`${houseWallet}|BTC`]: 99,
  [`${houseWallet}|ETH`]: 99,
  [`${houseWallet}|SOL`]: 99,
  [`${humanWallet}|BTC`]: 0.1,
  [`${humanWallet}|ETH`]: 0.1,
  [`${humanWallet}|SOL`]: 0.1,
});
store.setRoundCloses(roundId, { BTC: 100000, ETH: 2000, SOL: 100, fetchedAt: new Date().toISOString(), source: "test" }, "scored");

const { rows, prizeWinner } = buildLeaderboard(store.getRound(roundId));
assert(rows[0].wallet === humanWallet || rows[0].house === true, "sorted somehow");
const houseRow = rows.find((r) => r.wallet === houseWallet);
const humanRow = rows.find((r) => r.wallet === humanWallet);
assert(houseRow.house === true && houseRow.prizeEligible === false, "house flagged");
assert(humanRow.prizeEligible === true, "human eligible");
assert(prizeWinner.wallet === humanWallet, "prize winner is human even if house ranks first by score");
// Force house to be better score
store.applyErrors(roundId, {
  [`${houseWallet}|BTC`]: 0.01,
  [`${houseWallet}|ETH`]: 0.01,
  [`${houseWallet}|SOL`]: 0.01,
  [`${humanWallet}|BTC`]: 5,
  [`${humanWallet}|ETH`]: 5,
  [`${humanWallet}|SOL`]: 5,
});
const board2 = buildLeaderboard(store.getRound(roundId));
assert(board2.rows[0].wallet === houseWallet, "house is display #1");
assert(board2.prizeWinner.wallet === humanWallet, "human still prize winner");

let paidWallet = null;
const ap = await processAutopay(store, {
  enabled: true,
  requireWallet: false,
  getBalance: async () => ({ ui: 100, amount: 100_000000n }),
  sendFn: async ({ recipient, amountUsdc }) => {
    paidWallet = recipient;
    return { signature: "TestSigHouseExclusion111111111111111111111111111", explorer: "https://solscan.io/tx/test", confirmation: "confirmed" };
  },
});
assert(paidWallet === humanWallet, `autopay must pay human, got ${paidWallet}`);
assert(ap.results.some((r) => r.ok && r.type === "daily"), "daily payout ok");

// Free pulse store
const fps = new FreePulseStore(path.join(tmp, "free.json"));
const a = fps.tryConsume({ clientId: "walletABC12345", ip: "1.2.3.4" });
assert(a.ok, "first free ok");
const b = fps.tryConsume({ clientId: "walletABC12345", ip: "1.2.3.4" });
assert(!b.ok && b.reason === "free_quota_exhausted", "second denied");
const bad = fps.tryConsume({ clientId: "short", ip: "1.2.3.4" });
assert(!bad.ok && bad.reason === "invalid_client_id", "short id");

console.log("ALL_HOUSE_AND_FREE_TESTS_PASSED");
