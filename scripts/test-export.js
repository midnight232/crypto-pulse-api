/**
 * Admin export owedUnpaid/pending display tests.
 * Uses an isolated temp store. Does not send funds or print secrets.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import { parseRoundId } from "../src/arena/rounds.js";
import { _setStoreForTests, exportWinners } from "../src/arena/index.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function keypairWallet() {
  const kp = nacl.sign.keyPair();
  return base58.encode(kp.publicKey);
}

function seedCompleteBot(store, roundId, { wallet, botName, house = false, error = 0.2 }) {
  store.ensureRound(parseRoundId(roundId));
  for (const asset of ["BTC", "ETH", "SOL"]) {
    store.upsertPrediction(roundId, {
      wallet,
      botName,
      asset,
      price: asset === "BTC" ? 100000 : asset === "ETH" ? 2000 : 100,
      house,
    });
  }
  store.applyErrors(roundId, {
    [`${wallet}|BTC`]: error,
    [`${wallet}|ETH`]: error,
    [`${wallet}|SOL`]: error,
  });
  store.setRoundCloses(
    roundId,
    { BTC: 100000, ETH: 2000, SOL: 100, fetchedAt: new Date().toISOString(), source: "test" },
    "scored",
  );
}

function seedOpenBot(store, roundId, { wallet, botName, house = false }) {
  store.ensureRound(parseRoundId(roundId));
  for (const asset of ["BTC", "ETH", "SOL"]) {
    store.upsertPrediction(roundId, {
      wallet,
      botName,
      asset,
      price: asset === "BTC" ? 100000 : asset === "ETH" ? 2000 : 100,
      house,
    });
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "export-test-"));
const store = new ArenaStore(path.join(tmp, "arena.json"));
_setStoreForTests(store);

const human = keypairWallet();
const house = keypairWallet();

// Mid-week Nov 2–8: five scored days, week still open. Provisional weekly
// leader must be pending, not owed.
for (const id of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
  seedCompleteBot(store, id, { wallet: human, botName: "andy-moneyagent", error: 0.3 });
}
const midWeekNow = new Date("2026-11-07T12:00:00.000Z");
let exp = exportWinners({ now: midWeekNow });
const weekOpen = exp.weekly.find((w) => w.weekId === "2026-11-02");
assert(weekOpen, "open week present");
assert(weekOpen.botName === "andy-moneyagent", "provisional weekly leader kept");
assert(weekOpen.closed === false, "open week not closed");
assert(weekOpen.eligible === false, "open week not payable yet");
assert(weekOpen.payoutStatus === "pending", `open week status ${weekOpen.payoutStatus}`);
assert(
  !exp.owedUnpaid.some((x) => x.type === "weekly" && x.weekId === "2026-11-02"),
  "open week must not be in owedUnpaid",
);
assert(
  exp.pending.some((x) => x.type === "weekly" && x.weekId === "2026-11-02"),
  "open week listed under pending",
);

// Scored in-window daily with an eligible winner and no payout record is owed.
const nov3 = exp.daily.find((d) => d.roundId === "2026-11-03");
assert(nov3.closed && nov3.eligible && nov3.payoutStatus === "unpaid", "scored daily unpaid");
assert(
  exp.owedUnpaid.some((x) => x.type === "daily" && x.roundId === "2026-11-03" && x.botName === "andy-moneyagent"),
  "scored unpaid daily is owed",
);

// Nov 2 daily is scored with a winner but outside the funded daily window.
const nov2 = exp.daily.find((d) => d.roundId === "2026-11-02");
assert(nov2.payoutStatus === "outside_window", `nov2 daily status ${nov2.payoutStatus}`);
assert(
  !exp.owedUnpaid.some((x) => x.type === "daily" && x.roundId === "2026-11-02"),
  "outside-window daily is not owed",
);

// Open / not-yet-closed daily is pending, not owed (current entry 2026-11-08
// at midWeekNow: cutoff is 12h before close, so 2026-11-08 is locked/open).
seedOpenBot(store, "2026-11-08", { wallet: human, botName: "andy-moneyagent" });
exp = exportWinners({ now: midWeekNow });
const nov8 = exp.daily.find((d) => d.roundId === "2026-11-08");
assert(nov8, "open daily present");
assert(nov8.closed === false, "open daily not closed");
assert(nov8.eligible === false, "open daily not eligible for payout");
assert(nov8.payoutStatus === "pending", `open daily status ${nov8.payoutStatus}`);
assert(
  !exp.owedUnpaid.some((x) => x.type === "daily" && x.roundId === "2026-11-08"),
  "open daily must not be in owedUnpaid",
);
assert(
  exp.pending.some((x) => x.type === "daily" && x.roundId === "2026-11-08"),
  "open daily listed under pending",
);

// After the week closes and remaining days are scored, the weekly prize is owed
// until a payout is recorded as paid (or skipped).
seedCompleteBot(store, "2026-11-07", { wallet: human, botName: "andy-moneyagent", error: 0.3 });
seedCompleteBot(store, "2026-11-08", { wallet: human, botName: "andy-moneyagent", error: 0.3 });
const weekClosedNow = new Date("2026-11-09T00:00:01.000Z");
exp = exportWinners({ now: weekClosedNow });
const weekClosed = exp.weekly.find((w) => w.weekId === "2026-11-02");
assert(weekClosed.closed === true, "closed week marked closed");
assert(weekClosed.eligible === true, "closed week with winner is eligible");
assert(weekClosed.payoutStatus === "unpaid", `closed week status ${weekClosed.payoutStatus}`);
assert(
  exp.owedUnpaid.some((x) => x.type === "weekly" && x.weekId === "2026-11-02" && x.botName === "andy-moneyagent"),
  "closed unpaid week is owed",
);
assert(
  !exp.pending.some((x) => x.type === "weekly" && x.weekId === "2026-11-02"),
  "closed week is not pending",
);

// Shortfall-recorded weekly stays owed.
store.setPayout("weekly", "2026-11-02", {
  paid: false,
  status: "insufficient",
  amountUsdc: 10,
  wallet: human,
  botName: "andy-moneyagent",
  note: "insufficient_usdc",
});
exp = exportWinners({ now: weekClosedNow });
assert(
  exp.owedUnpaid.some((x) => x.type === "weekly" && x.weekId === "2026-11-02" && x.payoutStatus === "insufficient"),
  "insufficient weekly stays owed",
);

// Paid weekly leaves owedUnpaid.
store.setPayout("weekly", "2026-11-02", {
  paid: true,
  status: "paid",
  amountUsdc: 10,
  wallet: human,
  botName: "andy-moneyagent",
});
exp = exportWinners({ now: weekClosedNow });
assert(
  !exp.owedUnpaid.some((x) => x.type === "weekly" && x.weekId === "2026-11-02"),
  "paid weekly is not owed",
);

// Historical daily with no eligible winner (house only) is skipped, not owed.
const noWinStore = new ArenaStore(path.join(tmp, "arena-nowin.json"));
_setStoreForTests(noWinStore);
seedCompleteBot(noWinStore, "2026-11-01", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
exp = exportWinners({ now: new Date("2026-11-13T18:00:00.000Z") });
const nov1 = exp.daily.find((d) => d.roundId === "2026-11-01");
assert(nov1.closed === true, "nov1 scored/closed");
assert(nov1.eligible === false, "nov1 has no eligible winner");
assert(nov1.payoutStatus === "skipped", `nov1 status ${nov1.payoutStatus}`);
assert(nov1.note === "no_eligible_winner", `nov1 note ${nov1.note}`);
assert(
  !exp.owedUnpaid.some((x) => x.roundId === "2026-11-01" || x.wallet === house),
  "no-winner historical daily is not owed",
);
assert(!exp.pending.some((x) => x.roundId === "2026-11-01"), "scored no-winner is not pending");

// Same pattern after a week with only a house bot has fully closed.
seedCompleteBot(noWinStore, "2026-11-02", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
seedCompleteBot(noWinStore, "2026-11-03", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
seedCompleteBot(noWinStore, "2026-11-04", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
seedCompleteBot(noWinStore, "2026-11-05", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
seedCompleteBot(noWinStore, "2026-11-06", {
  wallet: house,
  botName: "official-baseline",
  house: true,
  error: 0.1,
});
exp = exportWinners({ now: new Date("2026-11-09T00:00:01.000Z") });
const houseWeek = exp.weekly.find((w) => w.weekId === "2026-11-02");
assert(houseWeek.closed === true, "house-only week closed");
assert(houseWeek.eligible === false, "house-only week has no eligible winner");
assert(houseWeek.payoutStatus === "skipped", `house week status ${houseWeek.payoutStatus}`);
assert(houseWeek.note === "no_eligible_winner", "house week labeled no winner");
assert(
  !exp.owedUnpaid.some((x) => x.type === "weekly" && x.weekId === "2026-11-02"),
  "no-winner week is not owed",
);

console.log("ALL_EXPORT_TESTS_PASSED");
