/**
 * Arena referral program tests. No mainnet spend; sendFn is injected
 * and REFERRAL_AUTOPAY is never set to on against a real wallet.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import { PulseUsageStore, _setPulseUsageStoreForTests } from "../src/pulse-usage.js";
import {
  ReferralStore,
  _setReferralStoreForTests,
  bindReferral,
  refreshReferralProgress,
  getReferralView,
  getReferrerDashboard,
  processReferralPayouts,
  remainingPrizeReserveUsdc,
  referralAdminSummary,
  REFERRAL_BASE_USDC,
  REFERRAL_BONUS_USDC,
  REFERRAL_QUALIFYING_DAYS,
} from "../src/arena/referrals.js";
import { AUTOPAY_DAILY_START, AUTOPAY_DAILY_END, AUTOPAY_WEEK_IDS } from "../src/arena/autopay.js";
import { DAILY_PRIZE_USDC, WEEKLY_PRIZE_USDC } from "../src/arena/prizes.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function wallet() {
  return base58.encode(nacl.sign.keyPair().publicKey);
}

function addPrediction(store, roundId, w, { botName = "test-bot", house = false, submittedAt } = {}) {
  store.ensureRound({
    roundId,
    openAt: `${roundId}T00:00:00.000Z`,
    cutoffAt: `${roundId}T12:00:00.000Z`,
    closeAt: `${nextDay(roundId)}T00:00:00.000Z`,
  });
  const pred = store.upsertPrediction(roundId, {
    wallet: w,
    botName,
    asset: "BTC",
    price: 100000,
    house,
  });
  if (submittedAt) {
    const row = store.getRound(roundId).predictions.find((p) => p.wallet === w && p.asset === "BTC");
    if (row) row.submittedAt = submittedAt;
    store._persist();
  }
  return pred;
}

function nextDay(roundId) {
  const d = new Date(`${roundId}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function recordPulse(usage, day, w, kind = "free") {
  usage.record({
    day,
    clientId: w,
    payerWallet: kind === "paid" ? w : null,
    kind,
    at: `${day}T15:00:00.000Z`,
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ref-"));
const arenaStore = new ArenaStore(path.join(tmp, "arena.json"));
const usage = new PulseUsageStore(path.join(tmp, "pulse-usage.json"));
const refStore = new ReferralStore(path.join(tmp, "referrals.json"));
_setPulseUsageStoreForTests(usage);
_setReferralStoreForTests(refStore);

assert(REFERRAL_BASE_USDC === 0.005, "base amount");
assert(REFERRAL_BONUS_USDC === 0.01, "bonus amount");
assert(REFERRAL_QUALIFYING_DAYS === 3, "three UTC days");

const referrer = wallet();
const referred = wallet();
const other = wallet();

// Referrer must already have a prediction.
let threw = false;
try {
  bindReferral({ referred, referrer, botName: "newbie", arenaStore, store: refStore });
} catch (err) {
  threw = err.code === "referrer_not_entrant";
}
assert(threw, "referrer without a prediction is rejected");

addPrediction(arenaStore, "2026-11-10", referrer, { botName: "referrer-bot", submittedAt: "2026-11-10T18:00:00.000Z" });

// Sybil-ish self-referral
threw = false;
try {
  bindReferral({ referred: referrer, referrer, botName: "self", arenaStore, store: refStore });
} catch (err) {
  threw = err.code === "self_referral";
}
assert(threw, "self-referral is rejected");

// Invalid pubkey
threw = false;
try {
  bindReferral({ referred, referrer: "not-a-wallet", arenaStore, store: refStore });
} catch (err) {
  threw = err.code === "invalid_referrer";
}
assert(threw, "invalid ref rejected");

// House cannot be referred (official- name)
threw = false;
try {
  bindReferral({
    referred: other,
    referrer,
    botName: "official-sneaky",
    arenaStore,
    store: refStore,
  });
} catch (err) {
  threw = err.code === "house_not_referable";
}
assert(threw, "house referred rejected");

// House cannot refer (prediction flagged house)
const houseWallet = wallet();
addPrediction(arenaStore, "2026-11-10", houseWallet, {
  botName: "official-baseline",
  house: true,
  submittedAt: "2026-11-10T18:00:00.000Z",
});
threw = false;
try {
  bindReferral({ referred, referrer: houseWallet, botName: "newbie", arenaStore, store: refStore });
} catch (err) {
  threw = err.code === "house_cannot_refer";
}
assert(threw, "house referrer rejected");

// Happy bind
const bound = bindReferral({ referred, referrer, botName: "newbie", arenaStore, store: refStore });
assert(bound.bound === true, "binds on first call");
assert(refStore.getBinding(referred).referrer === referrer, "stored referrer");

// Bind once — later ref ignored
const again = bindReferral({ referred, referrer: other, botName: "newbie", arenaStore, store: refStore });
assert(again.already === true, "already bound");
assert(refStore.getBinding(referred).referrer === referrer, "referrer never changes");

// Progress: 0 days until both pulse and predict land on the same UTC day
let view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.daysCompleted === 0, "no qualifying days yet");
assert(view.base.status === "incomplete", "base incomplete");
assert(view.bonus.status === "incomplete", "bonus incomplete");

// Day 1: predict only, no pulse
addPrediction(arenaStore, "2026-11-11", referred, { botName: "newbie", submittedAt: "2026-11-11T16:00:00.000Z" });
view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.daysCompleted === 0, "predict without pulse does not count");

// Day 1 pulse + already have predict
recordPulse(usage, "2026-11-11", referred, "free");
view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.daysCompleted === 1, `day 1 counts, got ${view.daysCompleted}`);

// Day 2 both
addPrediction(arenaStore, "2026-11-12", referred, { botName: "newbie", submittedAt: "2026-11-12T16:00:00.000Z" });
recordPulse(usage, "2026-11-12", referred, "free");
view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.daysCompleted === 2, "day 2 counts");
assert(refStore.getPayout(`base:${referred}`) === null, "base not earned at 2 days");

// Day 3 both (non-consecutive: skip 13, use 14)
addPrediction(arenaStore, "2026-11-14", referred, { botName: "newbie", submittedAt: "2026-11-14T16:00:00.000Z" });
recordPulse(usage, "2026-11-14", referred, "free");
view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.daysCompleted === 3, "3 non-consecutive UTC days");
assert(view.base.earned === true, "base earned");
assert(view.base.status === "queued", "base queued");
assert(refStore.getPayout(`base:${referred}`).amountUsdc === 0.005, "base amount");

// Refresh is idempotent — still one base payout
refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(refStore.listPayouts().filter((p) => p.type === "base" && p.referred === referred).length === 1, "base once");

// Bonus from first paid pulse
recordPulse(usage, "2026-11-14", referred, "paid");
view = refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(view.bonus.earned === true, "bonus earned");
assert(view.bonus.status === "queued", "bonus queued");
assert(refStore.getPayout(`bonus:${referred}`).amountUsdc === 0.01, "bonus amount");
refreshReferralProgress({ wallet: referred, arenaStore, usage, store: refStore });
assert(refStore.listPayouts().filter((p) => p.type === "bonus" && p.referred === referred).length === 1, "bonus once");

const dash = getReferrerDashboard(referrer, { arenaStore, usage, store: refStore });
assert(dash.referredCount === 1, "dashboard count");
assert(dash.referred[0].wallet === referred, "dashboard wallet");
assert(dash.totals.earnedUsdc === 0.015, `earned ${dash.totals.earnedUsdc}`);

// Prize reserve: unpaid program days + weeks
const emptyReserveStore = new ArenaStore(path.join(tmp, "arena-reserve.json"));
const start = new Date(`${AUTOPAY_DAILY_START}T00:00:00.000Z`);
const end = new Date(`${AUTOPAY_DAILY_END}T00:00:00.000Z`);
const dailyCount = Math.round((end - start) / 86400_000) + 1;
const expectedFull = dailyCount * DAILY_PRIZE_USDC + AUTOPAY_WEEK_IDS.length * WEEKLY_PRIZE_USDC;
assert(remainingPrizeReserveUsdc(emptyReserveStore) === expectedFull, `full reserve ${expectedFull} got ${remainingPrizeReserveUsdc(emptyReserveStore)}`);
emptyReserveStore.setPayout("daily", AUTOPAY_DAILY_START, { paid: true, status: "paid", amountUsdc: 1 });
emptyReserveStore.setPayout("weekly", AUTOPAY_WEEK_IDS[0], { status: "skipped", note: "no_eligible_winner" });
const after = remainingPrizeReserveUsdc(emptyReserveStore);
assert(after === expectedFull - 1 - 10, `reserve after paid+skipped ${after}`);

// Dry-run never sends
let sends = 0;
const dry = await processReferralPayouts(arenaStore, {
  store: refStore,
  usage,
  mode: "dry",
  now: new Date("2026-11-14T01:00:00.000Z"),
  dailyCapUsdc: 1,
  prizeReserveUsdc: 0,
  getBalance: async () => ({ ui: 100, amount: 100_000_000n }),
  sendFn: async () => {
    sends += 1;
    throw new Error("sendFn must not be called in dry mode");
  },
});
assert(dry.mode === "dry", "dry mode");
assert(sends === 0, "dry-run sent no USDC");
assert(dry.results.every((r) => r.dryRun), "all results dryRun");
assert(refStore.getPayout(`base:${referred}`).status === "queued", "dry leaves queued");
assert(refStore.getPayout(`bonus:${referred}`).status === "queued", "dry leaves bonus queued");
assert(!refStore.getPayout(`base:${referred}`).paid, "dry does not mark paid");

// Cap overflow queues FIFO to the next day (not dropped)
const capDir = path.join(tmp, "cap");
fs.mkdirSync(capDir, { recursive: true });
const capStore = new ReferralStore(path.join(capDir, "referrals.json"));
const capArena = new ArenaStore(path.join(capDir, "arena.json"));
const rA = wallet();
const rB = wallet();
const rC = wallet();
addPrediction(capArena, "2026-11-10", rA);
capStore.upsertPayout("base:one", {
  type: "base",
  referred: wallet(),
  referrer: rA,
  amountUsdc: 0.6,
  status: "queued",
  queuedAt: "2026-11-14T00:00:00.000Z",
});
capStore.upsertPayout("base:two", {
  type: "base",
  referred: wallet(),
  referrer: rB,
  amountUsdc: 0.5,
  status: "queued",
  queuedAt: "2026-11-14T00:00:01.000Z",
});
capStore.upsertPayout("bonus:three", {
  type: "bonus",
  referred: wallet(),
  referrer: rC,
  amountUsdc: 0.01,
  status: "queued",
  queuedAt: "2026-11-14T00:00:02.000Z",
});
const paidSigs = [];
const capDay1 = await processReferralPayouts(capArena, {
  store: capStore,
  usage,
  mode: "on",
  now: new Date("2026-11-14T02:00:00.000Z"),
  dailyCapUsdc: 1,
  prizeReserveUsdc: 0,
  getBalance: async () => ({ ui: 100, amount: 100_000_000n }),
  sendFn: async ({ recipient, amountUsdc }) => {
    const signature = `sig-${paidSigs.length}-${amountUsdc}`;
    paidSigs.push({ recipient, amountUsdc, signature });
    return { signature, explorer: `https://solscan.io/tx/${signature}`, confirmation: "confirmed" };
  },
});
assert(capStore.getPayout("base:one").status === "paid", "first FIFO item paid under cap");
assert(capStore.getPayout("base:one").txSignature, "tx signature logged");
assert(capStore.getPayout("base:two").status === "queued", "second overflows and stays queued");
assert(capStore.getPayout("base:two").deferredForDailyCap === true, "flagged deferred_daily_cap");
assert(capStore.getPayout("bonus:three").deferredForDailyCap === true, "later item also deferred");
assert(paidSigs.length === 1 && paidSigs[0].amountUsdc === 0.6, "only first payment sent on day 1");
assert(capDay1.results.some((r) => r.reason === "deferred_daily_cap"), "cap overflow reported");

const capDay2 = await processReferralPayouts(capArena, {
  store: capStore,
  usage,
  mode: "on",
  now: new Date("2026-11-15T02:00:00.000Z"),
  dailyCapUsdc: 1,
  prizeReserveUsdc: 0,
  getBalance: async () => ({ ui: 100, amount: 100_000_000n }),
  sendFn: async ({ recipient, amountUsdc }) => {
    const signature = `sig-d2-${paidSigs.length}-${amountUsdc}`;
    paidSigs.push({ recipient, amountUsdc, signature });
    return { signature, explorer: `https://solscan.io/tx/${signature}`, confirmation: "confirmed" };
  },
});
assert(capStore.getPayout("base:two").status === "paid", "overflow paid next UTC day FIFO");
assert(capStore.getPayout("bonus:three").status === "paid", "following FIFO item also paid next day");
assert(paidSigs.length === 3, "three sends across two days");
assert(capDay2.spentTodayUsdc === 0.51, `day2 spend ${capDay2.spentTodayUsdc}`);

// Reserve hold: balance minus prize reserve cannot cover the payout
const holdDir = path.join(tmp, "hold");
fs.mkdirSync(holdDir, { recursive: true });
const holdStore = new ReferralStore(path.join(holdDir, "referrals.json"));
const holdArena = new ArenaStore(path.join(holdDir, "arena.json"));
const holdRef = wallet();
addPrediction(holdArena, "2026-11-10", holdRef);
holdStore.upsertPayout("base:held", {
  type: "base",
  referred: wallet(),
  referrer: holdRef,
  amountUsdc: 0.005,
  status: "queued",
  queuedAt: "2026-11-14T00:00:00.000Z",
});
const held = await processReferralPayouts(holdArena, {
  store: holdStore,
  usage,
  mode: "on",
  now: new Date("2026-11-14T03:00:00.000Z"),
  dailyCapUsdc: 1,
  prizeReserveUsdc: 10,
  getBalance: async () => ({ ui: 10.004, amount: 10_004_000n }),
  sendFn: async () => {
    throw new Error("must not send when reserve cannot cover");
  },
});
assert(holdStore.getPayout("base:held").status === "held_reserve", "held for prize reserve");
assert(holdStore.getPayout("base:held").heldForPrizeReserve === true, "flag set");
assert(held.results[0].reason === "held_for_prize_reserve", "reason reported");
assert(!holdStore.getPayout("base:held").paid, "not paid");

const summary = referralAdminSummary({ arenaStore: holdArena, store: holdStore, usage });
assert(summary.totals.heldForPrizeReserve >= 1, "admin export flags held_reserve");
assert(summary.heldForPrizeReserve.some((p) => p.id === "base:held"), "held row in export");

// Once reserve + balance can cover, it pays
const released = await processReferralPayouts(holdArena, {
  store: holdStore,
  usage,
  mode: "on",
  now: new Date("2026-11-14T04:00:00.000Z"),
  dailyCapUsdc: 1,
  prizeReserveUsdc: 10,
  getBalance: async () => ({ ui: 10.005, amount: 10_005_000n }),
  sendFn: async ({ amountUsdc }) => ({
    signature: "sig-released",
    explorer: "https://solscan.io/tx/sig-released",
    confirmation: "confirmed",
  }),
});
assert(holdStore.getPayout("base:held").status === "paid", "pays once reserve allows");
assert(holdStore.getPayout("base:held").txSignature === "sig-released", "signature stored");
assert(released.results[0].ok === true, "released ok");

// Mode off skips sending
let offSends = 0;
await processReferralPayouts(arenaStore, {
  store: refStore,
  usage,
  mode: "off",
  getBalance: async () => ({ ui: 100, amount: 100n }),
  sendFn: async () => {
    offSends += 1;
    return { signature: "nope" };
  },
});
assert(offSends === 0, "off sends nothing");
assert(refStore.getPayout(`base:${referred}`).status === "queued", "off leaves queue");

console.log("ok: referrals self-referral, bind-once, 3-day base, paid bonus, dry-run, cap overflow FIFO, prize reserve hold");
