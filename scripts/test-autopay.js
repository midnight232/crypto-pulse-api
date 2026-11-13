/**
 * Autopay unit tests: caps, idempotency, insufficient funds, kill switch.
 * Uses in-memory temp store + mocked sendFn. Never touches mainnet.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import {
  attemptPayout,
  evaluatePayoutGuardrails,
  sumCommittedUsdcForUtcDay,
  utcDayKey,
  isValidSolanaPubkey,
  MAX_SINGLE_PAYOUT_USDC,
  MAX_DAILY_TOTAL_USDC,
  dailyRoundInAutopayWindow,
  weeklyInAutopayWindow,
} from "../src/arena/autopay.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autopay-test-"));
const store = new ArenaStore(path.join(tmp, "arena.json"));

const kp = nacl.sign.keyPair();
const goodWallet = base58.encode(kp.publicKey);

assert(isValidSolanaPubkey(goodWallet), "valid wallet");
assert(!isValidSolanaPubkey("not-a-key"), "invalid wallet");
assert(!isValidSolanaPubkey("11111111111111111111111111111111"), "zero wallet rejected via length/content? may be valid base58 32bytes of 1s");
// all-1s pubkey is valid length but we only reject all-zero; ok

assert(dailyRoundInAutopayWindow("2026-11-03"), "daily start");
assert(dailyRoundInAutopayWindow("2026-11-16"), "prior daily end still in");
assert(dailyRoundInAutopayWindow("2026-11-23"), "daily end");
assert(!dailyRoundInAutopayWindow("2026-11-02"), "nov2 daily out");
assert(!dailyRoundInAutopayWindow("2026-11-24"), "after daily end out");
assert(weeklyInAutopayWindow("2026-11-02"), "week1");
assert(weeklyInAutopayWindow("2026-11-09"), "week2");
assert(weeklyInAutopayWindow("2026-11-16"), "week3");
assert(!weeklyInAutopayWindow("2026-11-23"), "week4 out");

// Cap: single > 10
{
  const g = evaluatePayoutGuardrails({
    type: "daily",
    id: "2026-11-05",
    amountUsdc: 11,
    wallet: goodWallet,
    existing: null,
    payoutsSnapshot: { daily: {}, weekly: {} },
    enabled: true,
  });
  assert(!g.ok && g.reason === "exceeds_single_cap", "single cap");
}

// Cap: daily total
{
  const day = utcDayKey();
  const snap = {
    daily: {
      "2026-11-04": { paid: true, status: "paid", amountUsdc: 1, paidUtcDay: day, paidAt: new Date().toISOString() },
    },
    weekly: {
      "2026-11-02": { paid: true, status: "paid", amountUsdc: 10, paidUtcDay: day, paidAt: new Date().toISOString() },
    },
  };
  assert(sumCommittedUsdcForUtcDay(snap, day) === 11, "sum committed");
  const g = evaluatePayoutGuardrails({
    type: "daily",
    id: "2026-11-05",
    amountUsdc: 1,
    wallet: goodWallet,
    existing: null,
    payoutsSnapshot: snap,
    enabled: true,
  });
  assert(!g.ok && g.reason === "exceeds_daily_cap", "daily cap");
}

// Kill switch
{
  const g = evaluatePayoutGuardrails({
    type: "daily",
    id: "2026-11-05",
    amountUsdc: 1,
    wallet: goodWallet,
    existing: null,
    payoutsSnapshot: { daily: {}, weekly: {} },
    enabled: false,
  });
  assert(!g.ok && g.reason === "autopay_disabled", "disabled");
}

// Insufficient funds path
{
  let sends = 0;
  const r = await attemptPayout(store, {
    type: "daily",
    id: "2026-11-05",
    amountUsdc: 1,
    wallet: goodWallet,
    botName: "UnitBot",
    enabled: true,
    getBalance: async () => ({ ui: 0.5, amount: 500000n }),
    sendFn: async () => {
      sends++;
      return { signature: "fake", explorer: "https://solscan.io/tx/fake", confirmation: "confirmed" };
    },
  });
  assert(r.ok === false && r.reason === "insufficient_usdc", "insufficient");
  assert(sends === 0, "no send when insufficient");
  const row = store.getPayout("daily", "2026-11-05");
  assert(row.status === "insufficient" && row.paid === false, "recorded insufficient");
}

// Successful dry payout + idempotency
{
  let sends = 0;
  const sendFn = async ({ recipient, amountUsdc }) => {
    sends++;
    assert(recipient === goodWallet, "recipient");
    assert(amountUsdc === 1, "amount");
    return {
      signature: "TestSig1111111111111111111111111111111111111",
      explorer: "https://solscan.io/tx/TestSig",
      confirmation: "confirmed",
    };
  };
  const r1 = await attemptPayout(store, {
    type: "daily",
    id: "2026-11-06",
    amountUsdc: 1,
    wallet: goodWallet,
    enabled: true,
    getBalance: async () => ({ ui: 34, amount: 34000000n }),
    sendFn,
  });
  assert(r1.ok && r1.payout.status === "paid", "paid once");
  assert(sends === 1, "one send");

  const r2 = await attemptPayout(store, {
    type: "daily",
    id: "2026-11-06",
    amountUsdc: 1,
    wallet: goodWallet,
    enabled: true,
    getBalance: async () => ({ ui: 33, amount: 33000000n }),
    sendFn,
  });
  assert(r2.already, "idempotent");
  assert(sends === 1, "no second send");
}

// Pending reconcile → paid without resend
{
  store.setPayout("daily", "2026-11-07", {
    paid: false,
    status: "pending",
    pendingAt: new Date().toISOString(),
    paidUtcDay: utcDayKey(),
    amountUsdc: 1,
    wallet: goodWallet,
    txSignature: "PendingSig2222222222222222222222222222222222",
    explorer: "https://solscan.io/tx/PendingSig",
  });
  let sends = 0;
  const r = await attemptPayout(store, {
    type: "daily",
    id: "2026-11-07",
    amountUsdc: 1,
    wallet: goodWallet,
    enabled: true,
    getBalance: async () => ({ ui: 30, amount: 30000000n }),
    sendFn: async () => {
      sends++;
      return { signature: "x", confirmation: "confirmed" };
    },
    confirm: async () => "confirmed",
  });
  assert(r.already || r.payout.status === "paid", "reconciled");
  assert(sends === 0, "no resend after confirm");
  assert(store.getPayout("daily", "2026-11-07").paid === true, "marked paid");
}

assert(MAX_SINGLE_PAYOUT_USDC === 10 && MAX_DAILY_TOTAL_USDC === 11, "constants");
console.log("autopay unit tests ok");
