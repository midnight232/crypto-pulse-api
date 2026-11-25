/**
 * Pulse Forge phase 1 tests. Isolated temp files. No mainnet, no payouts, no secrets printed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import express from "express";
import { ArenaStore } from "../src/arena/store.js";
import { ReferralStore, _setReferralStoreForTests, bindReferral, refreshReferralProgress, REFERRAL_BASE_USDC, REFERRAL_BONUS_USDC } from "../src/arena/referrals.js";
import { PulseUsageStore, _setPulseUsageStoreForTests } from "../src/pulse-usage.js";
import { DAILY_PRIZE_USDC, WEEKLY_PRIZE_USDC, AUTOPAY_DAILY_END, AUTOPAY_WEEK_IDS } from "../src/arena/prizes.js";
import { PAID_RULE_FIRST_ROUND, NO_PAID_CALL_REASON } from "../src/pulse-usage.js";
import { predictForStrategy } from "../src/arena/house.js";
import { parseRoundId } from "../src/arena/rounds.js";
import {
  _setStoreForTests,
  currentEntryRound,
  getLeaderboard,
  getReferralView,
  getReferrerDashboardForRequest,
  getRoundResults,
  submitPrediction,
} from "../src/arena/index.js";
import {
  blendModuleQuotes,
  buildForgeConfigMessage,
  describeForgeCatalog,
  listForgeTemplates,
  listSignalModules,
  normalizeSnapshot,
  quoteModule,
} from "../src/arena/forge/signals.js";
import {
  ForgeBotStore,
  _setForgeBotStoreForTests,
  configureForgeBot,
  enterForgeBot,
  forgeConfigMessage,
  previewForgeBot,
} from "../src/arena/forge/bots.js";
import {
  ForgeProgressStore,
  _setForgeProgressStoreForTests,
  applyRoundProgress,
  levelForXp,
  readProgress,
} from "../src/arena/forge/progress.js";
import { nonCashForReferred, nonCashReferrerSummary, PRO_DAY_CREDITS } from "../src/arena/forge/referrals.js";
import { renderRoundCardSvg } from "../src/arena/forge/cards.js";
import { mountForgeRoutes } from "../src/arena/forge/routes.js";
import { renderArenaHtml } from "../src/arena/page.js";
import { renderRoundResultsHtml } from "../src/arena/results-page.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function walletOf(kp) {
  return base58.encode(kp.publicKey);
}

function sign(kp, message) {
  return base58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-"));
process.env.ARENA_HOUSE_WALLETS_PATH = path.join(tmp, "missing-house-wallets.json");
const arenaStore = new ArenaStore(path.join(tmp, "arena.json"));
const referralStore = new ReferralStore(path.join(tmp, "referrals.json"));
const usageStore = new PulseUsageStore(path.join(tmp, "pulse.json"));
const botStore = new ForgeBotStore(path.join(tmp, "bots.json"));
const progressStore = new ForgeProgressStore(path.join(tmp, "progress.json"));
_setStoreForTests(arenaStore);
_setReferralStoreForTests(referralStore);
_setPulseUsageStoreForTests(usageStore);
_setForgeBotStoreForTests(botStore);
_setForgeProgressStoreForTests(progressStore);

assert(DAILY_PRIZE_USDC === 1, "daily prize unchanged");
assert(WEEKLY_PRIZE_USDC === 10, "weekly prize unchanged");
assert(AUTOPAY_DAILY_END === "2026-11-30", "autopay end unchanged");
assert(
  AUTOPAY_WEEK_IDS.join(",") === "2026-11-02,2026-11-09,2026-11-16,2026-11-23",
  "autopay weeks unchanged",
);
assert(PAID_RULE_FIRST_ROUND === "2026-11-23", "paid-call rule start unchanged");
assert(NO_PAID_CALL_REASON === "not prize-eligible: no paid call", "paid-call reason unchanged");
assert(REFERRAL_BASE_USDC === 0.005, "referral base unchanged");
assert(REFERRAL_BONUS_USDC === 0.01, "referral bonus unchanged");

const modules = listSignalModules();
assert(modules.map((m) => m.id).join(",") === "baseline,momentum,meanrevert,feargreed,funding,defi", "module catalog");
const templateIds = listForgeTemplates().map((t) => t.id);
for (const id of ["baseline", "momentum", "mean-revert", "fear-greed", "funding-fade", "defi-yield", "balanced"]) {
  assert(templateIds.includes(id), `missing template ${id}`);
}
assert(describeForgeCatalog().cashPrizes === "unchanged", "catalog leaves prizes unchanged");

const rawSpots = {
  BTC: { usd: 100000, change24hPct: 10 },
  ETH: { usd: 2000, change24hPct: -10 },
  SOL: { usd: 100, change24hPct: 0 },
};
const snapshot = {
  spots: rawSpots,
  fearGreed: { value: 0 },
  funding: { BTC: 0.001, ETH: 0, SOL: null },
  defi: { avgStableApy: 15 },
};
const ctx = normalizeSnapshot(snapshot);
assert(quoteModule("baseline", "BTC", ctx).price === 100000, "baseline spot");
assert(quoteModule("momentum", "BTC", ctx).price === predictForStrategy("momentum", "BTC", rawSpots), "momentum matches house");
assert(quoteModule("meanrevert", "ETH", ctx).price === predictForStrategy("meanrevert", "ETH", rawSpots), "meanrevert matches house");
assert(quoteModule("momentum", "BTC", ctx).price === 110000, "momentum value");
assert(quoteModule("meanrevert", "ETH", ctx).price === 2100, "meanrevert value");
assert(quoteModule("feargreed", "BTC", ctx).price === 102000, "fear lifts quote");
assert(quoteModule("feargreed", "BTC", normalizeSnapshot({ spots: rawSpots, fearGreed: { value: 100 } })).price === 98000, "greed fades quote");
assert(quoteModule("feargreed", "BTC", normalizeSnapshot({ spots: rawSpots })).fallback === true, "missing fear falls back");
assert(quoteModule("funding", "BTC", ctx).price === 97600, "funding fade");
assert(quoteModule("funding", "SOL", ctx).fallback === true, "missing funding falls back");
assert(quoteModule("defi", "BTC", ctx).price === 101500, "high yield leans with the move");
assert(
  quoteModule("defi", "BTC", normalizeSnapshot({ spots: rawSpots, defi: { avgStableApy: 2 } })).price === 98500,
  "low yield fades the move",
);

const pulseShaped = {
  spotPrices: { ok: true, usd: { BTC: 100000 }, change24hPct: { BTC: 10 } },
  fearAndGreed: { ok: true, value: 0 },
  hyperliquidFunding: { ok: true, rates: { BTC: { funding: 0.001 } } },
  defi: { ok: true, topStableYields: [{ apy: 15 }, { apy: 15 }] },
};
const pulseCtx = normalizeSnapshot(pulseShaped);
assert(quoteModule("feargreed", "BTC", pulseCtx).price === 102000, "pulse-shaped fear");
assert(quoteModule("funding", "BTC", pulseCtx).price === 97600, "pulse-shaped funding");
assert(quoteModule("defi", "BTC", pulseCtx).price === 101500, "pulse-shaped defi");

const blended = blendModuleQuotes([
  { weight: 1, price: 110000 },
  { weight: 1, price: 100000 },
]);
assert(blended === 105000, "equal-weight blend");

const player = nacl.sign.keyPair();
const playerWallet = walletOf(player);
const preview = previewForgeBot({
  wallet: playerWallet,
  botName: "ForgeOne",
  modules: [
    { id: "momentum", weight: 1 },
    { id: "baseline", weight: 1 },
  ],
  snapshot,
  roundId: "2026-11-27",
});
const btcQuote = preview.quotes.find((q) => q.asset === "BTC");
assert(btcQuote.price === 105000, `blended BTC quote ${btcQuote.price}`);
assert(btcQuote.message.includes("asset=BTC"), "canonical message");
assert(btcQuote.message.includes("name=ForgeOne"), "bot name in message");
assert(preview.rankingComplete === true, "full asset set ranks");

const partial = previewForgeBot({
  wallet: playerWallet,
  botName: "ForgeOne",
  templateId: "momentum",
  assetPreset: "btc",
  snapshot,
});
assert(partial.quotes.length === 1 && partial.quotes[0].asset === "BTC", "btc preset");
assert(partial.rankingComplete === false, "partial entry is not ranked");
assert(partial.quotes[0].price === 110000, "template momentum quote");

let threw = false;
try {
  previewForgeBot({ wallet: playerWallet, botName: "Nope", modules: [{ id: "nope", weight: 1 }], snapshot });
} catch (err) {
  threw = err.code === "unknown_module";
}
assert(threw, "unknown module rejected");

const configBody = {
  wallet: playerWallet,
  botName: "ForgeOne",
  templateId: "momentum",
  assetPreset: "all",
};
const unsigned = forgeConfigMessage(configBody);
assert(unsigned.message === buildForgeConfigMessage(unsigned.config), "config message stable");
assert(unsigned.message.startsWith("crypto-pulse-forge:v1|"), "config prefix");

threw = false;
try {
  configureForgeBot({ ...configBody, signature: sign(nacl.sign.keyPair(), unsigned.message) });
} catch (err) {
  threw = err.code === "invalid_signature" && err.signMessage === unsigned.message;
}
assert(threw, "bad config signature rejected");

threw = false;
try {
  const msg = forgeConfigMessage({ ...configBody, botName: "official-momentum" });
  configureForgeBot({ ...configBody, botName: "official-momentum", signature: sign(player, msg.message) });
} catch (err) {
  threw = err.code === "reserved_bot_name";
}
assert(threw, "house name reserved");

const saved = configureForgeBot({ ...configBody, signature: sign(player, unsigned.message) });
assert(saved.ok && saved.bot.templateId === "momentum", "bot saved");
assert(saved.bot.modules.length === 1 && saved.bot.modules[0].id === "momentum", "template modules");
assert(!JSON.stringify(saved).includes("secret"), "config response has no secret field");

const round = currentEntryRound();
const quoted = previewForgeBot({ wallet: playerWallet, snapshot, roundId: round.roundId });
assert(quoted.quotes.length === 3, "saved bot quotes all assets");
const signatures = {};
for (const quote of quoted.quotes) signatures[quote.asset] = sign(player, quote.message);
const entered = enterForgeBot({
  wallet: playerWallet,
  roundId: round.roundId,
  snapshot,
  signatures,
  submitPrediction,
});
assert(entered.ok && entered.entries.length === 3, "entered three assets");
for (const entry of entered.entries) {
  assert(entry.prizeEligible === false, "forge entry does not bypass paid-call eligibility");
  assert(entry.ineligibleReason === NO_PAID_CALL_REASON, `reason ${entry.ineligibleReason}`);
  assert(entry.house === false, "player bot is not a house bot");
}
const board = getLeaderboard(round.roundId);
const row = board.ranking.find((r) => r.wallet === playerWallet);
assert(row, "forge bot is on the leaderboard");
assert(row.prizeEligible === false && row.prizeRank == null, "not prize ranked");
assert(board.prizeWinner == null, "no prize winner without a paid call");
assert(row.progression && row.progression.cash === false && row.progression.xp === 0, "unscored round has no XP yet");
assert(row.botName === "ForgeOne", "bot name preserved");

const liveRound = arenaStore.getRound(round.roundId);
const closes = {};
for (const asset of ["BTC", "ETH", "SOL"]) {
  closes[asset] = liveRound.predictions.find((p) => p.wallet === playerWallet && p.asset === asset).price;
}
const errorMap = {};
for (const asset of ["BTC", "ETH", "SOL"]) errorMap[`${playerWallet}|${asset}`] = 0;
arenaStore.applyErrors(round.roundId, errorMap);
arenaStore.setRoundCloses(round.roundId, { ...closes, fetchedAt: new Date().toISOString(), source: "test" }, "scored");
const awarded = applyRoundProgress(arenaStore, round.roundId);
assert(awarded.changed === true, "progress awarded");
const again = applyRoundProgress(arenaStore, round.roundId);
assert(again.changed === false, "progress award is idempotent");
const afterScore = getLeaderboard(round.roundId);
const scoredRow = afterScore.ranking.find((r) => r.wallet === playerWallet);
assert(scoredRow.rank === 1, "still rank 1");
assert(scoredRow.prizeEligible === false, "scoring did not grant eligibility");
assert(afterScore.prizeWinner == null, "prize winner still empty");
assert(scoredRow.progression.xp === 95, `xp ${scoredRow.progression.xp}`);
assert(scoredRow.progression.level === 1, "level 1 under 100 XP");
assert(scoredRow.progression.accuracyStreak === 1, "streak starts");
assert(scoredRow.progression.badges.some((b) => b.id === "first-round"), "first-round badge");
assert(scoredRow.progression.badges.some((b) => b.id === "sharpshooter"), "sharpshooter badge");
assert(scoredRow.share.ref === playerWallet, "share ref is the wallet");
assert(scoredRow.share.pagePath.includes(round.roundId), "share path");

function addScored(store, roundId, wallet, botName, error) {
  const meta = parseRoundId(roundId);
  store.ensureRound(meta);
  for (const asset of ["BTC", "ETH", "SOL"]) {
    store.upsertPrediction(roundId, { wallet, botName, asset, price: 100, house: false });
  }
  const map = {};
  for (const asset of ["BTC", "ETH", "SOL"]) map[`${wallet}|${asset}`] = error;
  store.applyErrors(roundId, map);
  store.setRoundCloses(
    roundId,
    { BTC: 100, ETH: 100, SOL: 100, fetchedAt: new Date().toISOString(), source: "test" },
    "scored",
  );
}

const streakWallet = walletOf(nacl.sign.keyPair());
addScored(arenaStore, "2026-10-01", streakWallet, "StreakBot", 0.4);
addScored(arenaStore, "2026-10-02", streakWallet, "StreakBot", 1.5);
addScored(arenaStore, "2026-10-03", streakWallet, "StreakBot", 0.8);
applyRoundProgress(arenaStore, "2026-10-01");
applyRoundProgress(arenaStore, "2026-10-02");
applyRoundProgress(arenaStore, "2026-10-03");
let prog = readProgress(streakWallet);
assert(prog.xp === 95 + 70 + 80, `streak xp ${prog.xp}`);
assert(prog.accuracyStreak === 3 && prog.bestAccuracyStreak === 3, "three-day streak");
assert(prog.badges.some((b) => b.id === "streak-3"), "streak-3 badge");
assert(prog.badges.some((b) => b.id === "centurion"), "centurion badge");
assert(levelForXp(prog.xp).level === prog.level, "level matches curve");
addScored(arenaStore, "2026-10-05", streakWallet, "StreakBot", 0.1);
applyRoundProgress(arenaStore, "2026-10-05");
prog = readProgress(streakWallet);
assert(prog.accuracyStreak === 1, "gap resets current streak");
assert(prog.bestAccuracyStreak === 3, "best streak kept");
const xpAfterGap = prog.xp;
applyRoundProgress(arenaStore, "2026-10-05");
assert(readProgress(streakWallet).xp === xpAfterGap, "gap award stays idempotent");

const accurate = walletOf(nacl.sign.keyPair());
const sloppy = walletOf(nacl.sign.keyPair());
addScored(arenaStore, "2026-11-24", accurate, "Accurate", 1);
addScored(arenaStore, "2026-10-01", sloppy, "Sloppy", 0.2);
addScored(arenaStore, "2026-10-02", sloppy, "Sloppy", 0.2);
addScored(arenaStore, "2026-10-03", sloppy, "Sloppy", 0.2);
addScored(arenaStore, "2026-11-24", sloppy, "Sloppy", 5);
applyRoundProgress(arenaStore, "2026-10-01");
applyRoundProgress(arenaStore, "2026-10-02");
applyRoundProgress(arenaStore, "2026-10-03");
applyRoundProgress(arenaStore, "2026-11-24");
const paidBoard = getLeaderboard("2026-11-24");
assert(paidBoard.ranking[0].wallet === accurate, "lower error still ranks first");
assert(paidBoard.ranking[1].wallet === sloppy, "higher XP does not outrank a better score");
assert(paidBoard.ranking[1].progression.xp > paidBoard.ranking[0].progression.xp, "sloppy has more XP");
assert(paidBoard.prizeWinner == null, "paid-call rule still blocks the prize");
assert(paidBoard.ranking[0].ineligibleReason === NO_PAID_CALL_REASON, "ineligible reason preserved");

const results = getRoundResults("2026-11-24");
assert(results.ranking[0].share.cardPath.endsWith(".svg"), "results include card path");
const html = renderRoundResultsHtml({ results, baseUrl: "http://127.0.0.1:9" });
assert(html.includes("share card"), "results page links the share card");
assert(html.includes("XP"), "results page shows XP");
const arenaHtml = renderArenaHtml({
  current: { roundId: "2026-11-27", status: "open", assets: ["BTC", "ETH", "SOL"], acceptingEntries: true },
  leaderboard: paidBoard,
  weekly: { ranking: [] },
  rules: {},
  baseUrl: "http://127.0.0.1:9",
  prizeStatus: {},
  forge: describeForgeCatalog(),
});
assert(arenaHtml.includes("Pulse Forge"), "arena page lists forge");
assert(arenaHtml.includes("Lv"), "arena leaderboard shows level");

const svg = renderRoundCardSvg({
  roundId: "2026-11-24",
  wallet: accurate,
  botName: "Accurate",
  rank: 1,
  avgAbsPctError: 1,
  level: 1,
  xp: 70,
  accuracyStreak: 1,
  badges: [{ id: "first-round", label: "First scored round" }],
});
assert(svg.includes("Accurate") && svg.includes("2026-11-24") && !svg.includes("<script"), "svg card");

const referrer = nacl.sign.keyPair();
const referred = nacl.sign.keyPair();
const referrerWallet = walletOf(referrer);
const referredWallet = walletOf(referred);
addScored(arenaStore, "2026-09-01", referrerWallet, "Referrer", 1);
bindReferral({
  referred: referredWallet,
  referrer: referrerWallet,
  botName: "Referred",
  arenaStore,
  store: referralStore,
});
for (const day of ["2026-09-02", "2026-09-03", "2026-09-04"]) {
  addScored(arenaStore, day, referredWallet, "Referred", 1);
  const pred = arenaStore.getRound(day).predictions.find((p) => p.wallet === referredWallet);
  pred.submittedAt = `${day}T12:00:00.000Z`;
}
arenaStore._persist();
const beforePayouts = referralStore.listPayouts().length;
const solo = nonCashReferrerSummary(referrerWallet, { arenaStore, referralStore });
assert(solo.proDayCredits === PRO_DAY_CREDITS, "3 play days credit 7 Pro days");
assert(solo.cash === false, "pro days are non-cash");
assert(referralStore.listPayouts().length === beforePayouts, "non-cash tracker does not enqueue USDC");
const unbound = nonCashForReferred(referrerWallet, { arenaStore, referralStore });
assert(unbound.proDayCredits === 0 && unbound.bound === false, "unbound wallet earns no Pro days");

for (const day of ["2026-09-02", "2026-09-03", "2026-09-04"]) {
  usageStore.record({ day, clientId: referredWallet, kind: "free", endpoint: "/v1/pulse", at: `${day}T15:00:00.000Z` });
}
refreshReferralProgress({ wallet: referredWallet, arenaStore, usage: usageStore, store: referralStore });
const payouts = referralStore.listPayouts();
assert(payouts.length === 1 && payouts[0].amountUsdc === REFERRAL_BASE_USDC, "existing USDC base reward still queues");
assert(payouts[0].status === "queued", "queued, not sent");
const dash = getReferrerDashboardForRequest(referrerWallet);
assert(dash.nonCash.proDayCredits === PRO_DAY_CREDITS, "dashboard non-cash total");
assert(dash.referred[0].base.amountUsdc === REFERRAL_BASE_USDC, "dashboard cash amount unchanged");
assert(dash.referred[0].nonCash.qualified === true, "per-bot non-cash progress");
const selfView = getReferralView(referredWallet, { arenaStore, store: referralStore, usage: usageStore });
assert(selfView.base.amountUsdc === REFERRAL_BASE_USDC, "referral view cash field unchanged");
assert(selfView.nonCash.proDayCredits === PRO_DAY_CREDITS, "referral view includes Pro days");

const app = express();
app.use(express.json());
mountForgeRoutes(app);
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const catalogRes = await fetch(`${base}/v1/forge`);
const catalog = await catalogRes.json();
assert(catalogRes.status === 200 && catalog.modules.length === 6, "GET /v1/forge");
const templatesRes = await fetch(`${base}/v1/forge/templates`);
const templatesBody = await templatesRes.json();
assert(templatesBody.templates.length === 7 && templatesBody.assetPresets.length === 4, "templates route");

const msgRes = await fetch(`${base}/v1/forge/config-message`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: playerWallet, botName: "ForgeHttp", templateId: "balanced" }),
});
const msgBody = await msgRes.json();
assert(msgRes.status === 200 && msgBody.message.includes("template=balanced"), "config message route");
const saveRes = await fetch(`${base}/v1/forge/bots`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: playerWallet,
    botName: "ForgeHttp",
    templateId: "balanced",
    signature: sign(player, msgBody.message),
  }),
});
assert(saveRes.status === 200 || saveRes.status === 201, `save bot ${saveRes.status}`);
const got = await fetch(`${base}/v1/forge/bots/${playerWallet}`);
const gotBody = await got.json();
assert(gotBody.bot.botName === "ForgeHttp", "saved bot readable");

const cardRes = await fetch(`${base}/v1/forge/cards/round/2026-11-24/${accurate}.svg`);
const cardText = await cardRes.text();
assert(cardRes.status === 200 && cardRes.headers.get("content-type").includes("svg"), "svg content type");
assert(cardText.includes("Accurate") && cardText.includes("2026-11-24"), "svg body");
const shareRes = await fetch(`${base}/arena/forge/share/2026-11-24/${accurate}`);
const shareHtml = await shareRes.text();
assert(shareRes.status === 200, "share page");
assert(shareHtml.includes('property="og:image"'), "og image");
assert(shareHtml.includes(`ref=${accurate}`), "share link carries referral code");
assert(shareHtml.includes(".svg"), "og image points at the svg");
const streakRes = await fetch(`${base}/arena/forge/streak/${streakWallet}`);
const streakHtml = await streakRes.text();
assert(streakRes.status === 200 && streakHtml.includes("streak") && streakHtml.includes(`ref=${streakWallet}`), "streak page");
const xpRes = await fetch(`${base}/v1/forge/leaderboard`);
const xpBody = await xpRes.json();
assert(xpBody.cash === false && xpBody.ranking.some((r) => r.wallet === streakWallet), "xp board");

server.close();
console.log("ALL_FORGE_TESTS_PASSED");
