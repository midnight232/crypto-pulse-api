/**
 * Prize eligibility from /v1/pulse calls. No mainnet spend.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import { buildLeaderboard } from "../src/arena/scoring.js";
import { buildWeeklyLeaderboard } from "../src/arena/weekly.js";
import { processAutopay } from "../src/arena/autopay.js";
import {
  PulseUsageStore,
  extractPayerWallet,
  pulseUsageDayForRound,
  pulseRuleApplies,
  pulseQualification,
  NO_PULSE_REASON,
  NO_PAID_CALL_REASON,
  PULSE_RULE_FIRST_ROUND,
  PULSE_RULE_LAST_ROUND,
  PAID_RULE_FIRST_ROUND,
  paidRuleApplies,
  eligibilityRuleForRound,
  _setPulseUsageStoreForTests,
} from "../src/pulse-usage.js";
import { buildPrizeEligibility, decorateWithPrizeEligibility, prizeEligibilityWarning, getArenaEntry, _setStoreForTests } from "../src/arena/index.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(PULSE_RULE_FIRST_ROUND === "2026-11-13", "first enforced round");
assert(pulseUsageDayForRound("2026-11-13") === "2026-11-12", "qualifying day is day before close");
assert(pulseUsageDayForRound("2026-11-12") === "2026-11-11", "prior round day");
assert(pulseRuleApplies("2026-11-13") === true, "applies 13");
assert(pulseRuleApplies("2026-11-12") === false, "does not apply to already-closed 12");
assert(NO_PULSE_REASON === "not prize-eligible: no /v1/pulse call", "reason wording");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-elig-"));
const usage = new PulseUsageStore(path.join(tmp, "pulse-usage.json"));
_setPulseUsageStoreForTests(usage);

function wallet() {
  return base58.encode(nacl.sign.keyPair().publicKey);
}

function fillRound(store, roundId, entries, closes = { BTC: 100000, ETH: 2000, SOL: 100 }) {
  store.ensureRound({
    roundId,
    openAt: `${roundId}T00:00:00.000Z`,
    cutoffAt: `${roundId}T00:00:00.000Z`,
    closeAt: `${roundId}T00:00:00.000Z`,
  });
  const errors = {};
  for (const e of entries) {
    for (const asset of ["BTC", "ETH", "SOL"]) {
      store.upsertPrediction(roundId, {
        wallet: e.wallet,
        botName: e.botName,
        asset,
        price: e.prices?.[asset] ?? closes[asset],
        house: Boolean(e.house),
      });
      errors[`${e.wallet}|${asset}`] = e.error ?? 0.1;
    }
  }
  store.applyErrors(roundId, errors);
  store.setRoundCloses(roundId, { ...closes, fetchedAt: new Date().toISOString(), source: "test" }, "scored");
  return buildLeaderboard(store.getRound(roundId), { usage });
}

// --- extract payer from payment header ---
const payer = wallet();
const headerObj = {
  x402Version: 2,
  accepted: { scheme: "exact", network: "solana:mainnet" },
  payload: { payer },
};
const encoded = Buffer.from(JSON.stringify(headerObj), "utf8").toString("base64");
const extracted = extractPayerWallet({
  get: (n) => (String(n).toLowerCase() === "payment-signature" ? encoded : ""),
});
assert(extracted === payer, `extractPayerWallet got ${extracted}`);

// --- already-closed round 2026-11-12 is unchanged (no pulse required) ---
const storeOld = new ArenaStore(path.join(tmp, "arena-old.json"));
const wOld = wallet();
const boardOld = fillRound(storeOld, "2026-11-12", [{ wallet: wOld, botName: "OldBot", error: 0.2 }]);
assert(boardOld.rows[0].prizeEligible === true, "pre-enforcement still eligible without pulse");
assert(boardOld.prizeWinner.wallet === wOld, "pre-enforcement winner");
assert(!boardOld.rows[0].ineligibleReason, "no pulse reason on old round");

// --- enforced daily round ---
const store = new ArenaStore(path.join(tmp, "arena.json"));
const wA = wallet();
const wB = wallet();
const wHouse = wallet();
const boardNone = fillRound(store, "2026-11-13", [
  { wallet: wA, botName: "PulseBot", error: 1.0 },
  { wallet: wB, botName: "NoPulseBot", error: 0.01 }, // better score, no pulse
  { wallet: wHouse, botName: "official-baseline", error: 0.001, house: true },
]);
const a0 = boardNone.rows.find((r) => r.wallet === wA);
const b0 = boardNone.rows.find((r) => r.wallet === wB);
const h0 = boardNone.rows.find((r) => r.wallet === wHouse);
assert(a0 && b0 && h0, "three rows scored");
assert(b0.rank === 2 || b0.avgAbsPctError < a0.avgAbsPctError, "B has better score than A");
assert(a0.prizeEligible === false && a0.ineligibleReason === NO_PULSE_REASON, "A ineligible without pulse");
assert(b0.prizeEligible === false && b0.ineligibleReason === NO_PULSE_REASON, "B ineligible without pulse");
assert(h0.house === true && h0.prizeEligible === false, "house still ineligible");
assert(boardNone.prizeWinner == null, "no prize winner yet");

// Free call with client id = payout wallet marks A eligible
usage.record({ day: "2026-11-12", clientId: wA, kind: "free" });
const boardFree = buildLeaderboard(store.getRound("2026-11-13"), { usage });
const a1 = boardFree.rows.find((r) => r.wallet === wA);
const b1 = boardFree.rows.find((r) => r.wallet === wB);
assert(a1.prizeEligible === true && a1.eligible === true && !a1.ineligibleReason, "A eligible after free call");
assert(b1.prizeEligible === false && b1.ineligibleReason === NO_PULSE_REASON, "B still ineligible");
assert(boardFree.prizeWinner.wallet === wA, "prize goes to best eligible (A), not better-scoring B");
assert(a1.pulseQualified === true && a1.pulseDay === "2026-11-12", "pulse day recorded");

// Paid payer wallet marks C eligible (and client-id header marks D)
const wC = wallet();
const wD = wallet();
const wOtherPayer = wallet();
fillRound(store, "2026-11-14", [
  { wallet: wC, botName: "PaidPayer", error: 0.5 },
  { wallet: wD, botName: "PaidHeader", error: 0.6 },
]);
usage.record({ day: "2026-11-13", payerWallet: wC, kind: "paid" });
usage.record({ day: "2026-11-13", clientId: wD, payerWallet: wOtherPayer, kind: "paid" });
const boardPaid = buildLeaderboard(store.getRound("2026-11-14"), { usage });
assert(boardPaid.rows.find((r) => r.wallet === wC).prizeEligible === true, "paid payer matches");
assert(boardPaid.rows.find((r) => r.wallet === wD).prizeEligible === true, "paid client-id header matches");

// House bot with a pulse call stays ineligible
usage.record({ day: "2026-11-12", clientId: wHouse, kind: "free" });
const boardHouse = buildLeaderboard(store.getRound("2026-11-13"), { usage });
assert(boardHouse.rows.find((r) => r.wallet === wHouse).prizeEligible === false, "house stays ineligible");

// --- weekly: Nov 9–15 only counts pulse days from 13 onward ---
const storeW = new ArenaStore(path.join(tmp, "arena-week.json"));
const wWeek = wallet();
const wWeekNo = wallet();
for (const day of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
  fillRound(storeW, day, [
    { wallet: wWeek, botName: "WeekYes", error: 0.4 },
    { wallet: wWeekNo, botName: "WeekNo", error: 0.3 },
  ]);
}
// Only WeekYes made a pulse call on the 13th's qualifying day (2026-11-12)
usage.record({ day: "2026-11-12", clientId: wWeek, kind: "free" });
const weekly = buildWeeklyLeaderboard(storeW, "2026-11-09");
const yes = weekly.ranking.find((r) => r.wallet === wWeek);
const no = weekly.ranking.find((r) => r.wallet === wWeekNo);
assert(yes && no, "both weekly rows shown");
assert(yes.roundsEntered >= 5 && no.roundsEntered >= 5, "both meet min rounds");
assert(yes.prizeEligible === true, "weekly eligible with pulse on an enforced day");
assert(no.prizeEligible === false && no.ineligibleReason === NO_PULSE_REASON, "weekly ineligible without pulse from 13 onward");
assert(weekly.prizeWinner.wallet === wWeek, "weekly prize winner is pulse-qualified bot");
assert(weekly.ranking.length === 2, "ineligible weekly bot still shown");

// Autopay pays A on 2026-11-13, not B or house
const paidWallets = [];
_setPulseUsageStoreForTests(usage);
const ap = await processAutopay(store, {
  enabled: true,
  requireWallet: false,
  now: new Date("2026-11-13T00:01:00.000Z"),
  getBalance: async () => ({ ui: 100, amount: 100_000000n }),
  sendFn: async ({ recipient }) => {
    paidWallets.push(recipient);
    return {
      signature: "TestSigPulseElig111111111111111111111111111111",
      explorer: "https://solscan.io/tx/test",
      confirmation: "confirmed",
    };
  },
});
assert(paidWallets.includes(wA), `autopay must pay pulse-eligible A, got ${paidWallets.join(",")}`);
assert(
  ap.results.some((r) => r.ok && r.type === "daily" && r.id === "2026-11-13"),
  "daily 13 payout ok",
);

// Backfill from free-pulse.json
const freePath = path.join(tmp, "free-pulse.json");
const wBack = wallet();
fs.writeFileSync(
  freePath,
  JSON.stringify({
    version: 1,
    days: {
      "2026-11-12": { clients: { [wBack]: { at: "2026-11-12T03:00:00.000Z" } }, ips: {} },
    },
  }) + "\n",
);
const imported = usage.ingestFreePulseFile(freePath);
assert(imported.imported >= 1, "backfill imported");
assert(usage.matches("2026-11-12", wBack), "backfilled client id counts");
assert(pulseQualification({ wallet: wBack, roundId: "2026-11-13", usage }).qualified === true, "backfill qualifies");


// --- prizeEligibility notice object ---
const noticeStore = new ArenaStore(path.join(tmp, "arena-notice.json"));
_setStoreForTests(noticeStore);
const wNotice = wallet();
const pe = buildPrizeEligibility({
  wallet: wNotice,
  botName: "NoticeBot",
  roundId: "2026-11-13",
  baseUrl: "https://cryptopulseapi.com",
});
assert(pe.eligible === false, "notice ineligible without pulse");
assert(pe.applicable === true, "rule applies");
assert(typeof pe.requirement === "string" && pe.requirement.includes("/v1/pulse"), "requirement");
assert(pe.howTo === `GET https://cryptopulseapi.com/v1/pulse with headers X-Crypto-Pulse-Free: 1 and X-Pulse-Client-Id: ${wNotice}`, "howTo uses payout wallet");
assert(pe.deadline === "2026-11-13T00:00:00.000Z", "deadline is closeAt");
assert(pe.docs === "https://cryptopulseapi.com/v1/arena/rules", "docs url");
const decorated = decorateWithPrizeEligibility({ ok: true, created: true }, {
  wallet: wNotice,
  botName: "NoticeBot",
  roundId: "2026-11-13",
  baseUrl: "https://cryptopulseapi.com",
});
assert(decorated.ok === true && decorated.created === true, "existing fields preserved");
assert(decorated.prizeEligibility.eligible === false, "decorated ineligible");
assert(typeof decorated.warning === "string" && decorated.warning.includes("Not prize-eligible"), "warning on ineligible");

usage.record({ day: "2026-11-12", clientId: wNotice, kind: "free" });
const peYes = buildPrizeEligibility({
  wallet: wNotice,
  botName: "NoticeBot",
  roundId: "2026-11-13",
  baseUrl: "https://cryptopulseapi.com",
});
assert(peYes.eligible === true, "eligible after pulse");
assert(!prizeEligibilityWarning(peYes), "no warning when eligible");

const peHouse = buildPrizeEligibility({
  wallet: wHouse,
  botName: "official-baseline",
  roundId: "2026-11-13",
  baseUrl: "https://cryptopulseapi.com",
});
assert(peHouse.eligible === false && peHouse.applicable === false, "house notice not applicable");
assert(peHouse.requirement.toLowerCase().includes("not applicable"), "house requirement");
const decHouse = decorateWithPrizeEligibility({ ok: true }, {
  wallet: wHouse,
  botName: "official-baseline",
  roundId: "2026-11-13",
});
assert(!decHouse.warning, "house responses have no warning");

fillRound(noticeStore, "2026-11-13", [{ wallet: wNotice, botName: "NoticeBot", error: 0.2 }]);
const entry = getArenaEntry({ wallet: wNotice, roundId: "2026-11-13", baseUrl: "https://cryptopulseapi.com" });
assert(entry.wallet === wNotice && entry.complete === true, "entry status");
assert(entry.prizeEligibility.eligible === true, "entry reflects pulse");
assert(!entry.warning, "no warning on eligible entry");

// --- paid-call rule starting with round 2026-11-23 ---
assert(PAID_RULE_FIRST_ROUND === "2026-11-23", "paid rule first round");
assert(PULSE_RULE_LAST_ROUND === "2026-11-22", "pulse rule last round");
assert(paidRuleApplies("2026-11-22") === false, "paid rule not on 22");
assert(paidRuleApplies("2026-11-23") === true, "paid rule on 23");
assert(eligibilityRuleForRound("2026-11-12") === "none", "pre-enforcement rule");
assert(eligibilityRuleForRound("2026-11-22") === "pulse", "22 still pulse");
assert(eligibilityRuleForRound("2026-11-23") === "paid", "23 is paid");
assert(NO_PAID_CALL_REASON === "not prize-eligible: no paid call", "paid reason wording");
assert(pulseUsageDayForRound("2026-11-23") === "2026-11-22", "round 23 qualifies on 22 UTC");
assert(pulseUsageDayForRound("2026-11-22") === "2026-11-21", "round 22 qualifies on 21 UTC");

const storePaid = new ArenaStore(path.join(tmp, "arena-paid-rule.json"));
const wFreeOnly = wallet();
const wSpots = wallet();
const wPaidPulse = wallet();
const wNone = wallet();

// Last pulse-rule day: free pulse still qualifies; spots-only does not
fillRound(storePaid, "2026-11-22", [
  { wallet: wFreeOnly, botName: "FreeStillOk", error: 0.4 },
  { wallet: wSpots, botName: "SpotsOnlyOld", error: 0.3 },
  { wallet: wNone, botName: "NoCallOld", error: 0.2 },
]);
usage.record({ day: "2026-11-21", clientId: wFreeOnly, kind: "free", endpoint: "/v1/pulse" });
usage.record({ day: "2026-11-21", clientId: wSpots, kind: "paid", endpoint: "/v1/spots" });
const board22 = buildLeaderboard(storePaid.getRound("2026-11-22"), { usage });
assert(board22.rows.find((r) => r.wallet === wFreeOnly).prizeEligible === true, "free pulse still qualifies on 22");
assert(board22.rows.find((r) => r.wallet === wSpots).prizeEligible === false, "spots-only does not satisfy pulse rule on 22");
assert(board22.rows.find((r) => r.wallet === wNone).ineligibleReason === NO_PULSE_REASON, "22 uses pulse ineligible reason");

// First paid-rule day: free pulse does not qualify; paid spots and paid pulse do
fillRound(storePaid, "2026-11-23", [
  { wallet: wFreeOnly, botName: "FreeOnlyNew", error: 0.1 },
  { wallet: wSpots, botName: "SpotsNew", error: 0.5 },
  { wallet: wPaidPulse, botName: "PaidPulseNew", error: 0.4 },
  { wallet: wNone, botName: "NoCallNew", error: 0.2 },
]);
usage.record({ day: "2026-11-22", clientId: wFreeOnly, kind: "free", endpoint: "/v1/pulse" });
usage.record({ day: "2026-11-22", clientId: wSpots, kind: "paid", endpoint: "/v1/spots" });
usage.record({ day: "2026-11-22", payerWallet: wPaidPulse, kind: "paid", endpoint: "/v1/pulse" });
const board23 = buildLeaderboard(storePaid.getRound("2026-11-23"), { usage });
const free23 = board23.rows.find((r) => r.wallet === wFreeOnly);
const spots23 = board23.rows.find((r) => r.wallet === wSpots);
const paid23 = board23.rows.find((r) => r.wallet === wPaidPulse);
const none23 = board23.rows.find((r) => r.wallet === wNone);
assert(free23.prizeEligible === false && free23.ineligibleReason === NO_PAID_CALL_REASON, "free pulse no longer qualifies on 23");
assert(spots23.prizeEligible === true, "paid /v1/spots qualifies on 23");
assert(paid23.prizeEligible === true, "paid /v1/pulse qualifies on 23");
assert(none23.prizeEligible === false && none23.ineligibleReason === NO_PAID_CALL_REASON, "23 uses paid ineligible reason");
assert(board23.prizeWinner.wallet === wSpots || board23.prizeWinner.wallet === wPaidPulse, "prize winner is a paid-call bot");
assert(board23.prizeWinner.wallet !== wFreeOnly, "free-only bot is not the prize winner");

// Free then paid spots later the same day upgrades the row
const wUpgrade = wallet();
fillRound(storePaid, "2026-11-24", [{ wallet: wUpgrade, botName: "UpgradeBot", error: 0.3 }]);
usage.record({ day: "2026-11-23", clientId: wUpgrade, kind: "free", endpoint: "/v1/pulse" });
const beforeUpgrade = buildLeaderboard(storePaid.getRound("2026-11-24"), { usage });
assert(beforeUpgrade.rows[0].prizeEligible === false, "free only, not yet paid");
usage.record({ day: "2026-11-23", clientId: wUpgrade, kind: "paid", endpoint: "/v1/spots" });
const afterUpgrade = buildLeaderboard(storePaid.getRound("2026-11-24"), { usage });
assert(afterUpgrade.rows[0].prizeEligible === true, "upgraded free+spots qualifies");
assert(usage.matches("2026-11-23", wUpgrade) === true, "upgrade still counts as pulse for referrals/old rule");
assert(usage.matchesPaid("2026-11-23", wUpgrade) === true, "upgrade counts as paid");

// Week of Nov 16–22 still uses the pulse (free or paid) rule
const storeW16 = new ArenaStore(path.join(tmp, "arena-week16.json"));
const wWeekFree = wallet();
const wWeekNo2 = wallet();
for (const day of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) {
  fillRound(storeW16, day, [
    { wallet: wWeekFree, botName: "Week16Free", error: 0.4 },
    { wallet: wWeekNo2, botName: "Week16None", error: 0.3 },
  ]);
}
usage.record({ day: "2026-11-21", clientId: wWeekFree, kind: "free", endpoint: "/v1/pulse" });
const weekly16 = buildWeeklyLeaderboard(storeW16, "2026-11-16");
assert(weekly16.ranking.find((r) => r.wallet === wWeekFree).prizeEligible === true, "Nov 16-22 weekly: free pulse still enough");
assert(weekly16.ranking.find((r) => r.wallet === wWeekNo2).prizeEligible === false, "Nov 16-22 weekly: no pulse ineligible");
assert(weekly16.ranking.find((r) => r.wallet === wWeekNo2).ineligibleReason === NO_PULSE_REASON, "Nov 16-22 weekly uses pulse reason");

// Week of Nov 23–29 requires a paid call
const storeW23 = new ArenaStore(path.join(tmp, "arena-week23.json"));
const wWeekPaid = wallet();
const wWeekFree2 = wallet();
for (const day of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) {
  fillRound(storeW23, day, [
    { wallet: wWeekPaid, botName: "Week23Paid", error: 0.4 },
    { wallet: wWeekFree2, botName: "Week23Free", error: 0.3 },
  ]);
}
usage.record({ day: "2026-11-22", clientId: wWeekPaid, kind: "paid", endpoint: "/v1/spots" });
usage.record({ day: "2026-11-22", clientId: wWeekFree2, kind: "free", endpoint: "/v1/pulse" });
const weekly23 = buildWeeklyLeaderboard(storeW23, "2026-11-23");
assert(weekly23.ranking.find((r) => r.wallet === wWeekPaid).prizeEligible === true, "Nov 23-29 weekly: paid spots enough");
const weekFreeRow = weekly23.ranking.find((r) => r.wallet === wWeekFree2);
assert(weekFreeRow.prizeEligible === false && weekFreeRow.ineligibleReason === NO_PAID_CALL_REASON, "Nov 23-29 weekly: free pulse not enough");
assert(weekly23.prizeWinner.wallet === wWeekPaid, "Nov 23-29 weekly winner is paid-call bot");

// Notices for a paid-rule round
const pePaid = buildPrizeEligibility({
  wallet: wNone,
  botName: "NoticePaid",
  roundId: "2026-11-23",
  baseUrl: "https://cryptopulseapi.com",
});
assert(pePaid.eligible === false && pePaid.applicable === true && pePaid.rule === "paid", "paid-rule notice");
assert(typeof pePaid.requirement === "string" && pePaid.requirement.includes("paid call"), "paid requirement");
assert(pePaid.howTo.includes("/v1/spots") && pePaid.howTo.includes(wNone), "paid howTo mentions spots and wallet");
assert(prizeEligibilityWarning(pePaid).includes("no paid call"), "paid warning wording");
const pePaidOk = buildPrizeEligibility({
  wallet: wSpots,
  botName: "NoticePaidOk",
  roundId: "2026-11-23",
  baseUrl: "https://cryptopulseapi.com",
});
assert(pePaidOk.eligible === true && pePaidOk.rule === "paid", "paid-rule notice eligible after spots");
assert(!prizeEligibilityWarning(pePaidOk), "no warning when paid-eligible");

console.log("ALL_PULSE_ELIGIBILITY_TESTS_PASSED");
