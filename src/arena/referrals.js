/**
 * Arena referral program.
 *
 * A new bot may name a referrer once, on its first POST /v1/arena/predict,
 * via optional `ref` (payout wallet), the MCP submit tool, or header
 * X-Pulse-Referrer. The binding never changes. Self-referral is rejected.
 * House bots cannot refer or be referred. The referrer must already have
 * at least one Arena prediction.
 *
 * Rewards (once each per referred wallet), paid to the referrer:
 *   - base  0.005 USDC after the referred bot has both a /v1/pulse call
 *     (free counts) and an Arena prediction on 3 distinct UTC days
 *   - bonus 0.01  USDC the first time the referred bot makes a paid x402
 *     /v1/pulse call (payer wallet or X-Pulse-Client-Id matches)
 *
 * Daily cap (REFERRAL_DAILY_CAP_USDC, default $1) — overflow queues FIFO
 * to the next UTC day. Payouts never spend the reserve needed for remaining
 * daily/weekly prizes. Uses the prize-wallet autopay sender. Default
 * REFERRAL_AUTOPAY=dry records what would be paid without sending USDC.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../config.js";
import { utcDayKey, getPulseUsageStore } from "../pulse-usage.js";
import { isHouseEntrant, isHouseWallet, isHouseBotName } from "./house.js";
import { isValidSolanaPubkey } from "./autopay.js";
import {
  AUTOPAY_DAILY_START,
  AUTOPAY_DAILY_END,
  AUTOPAY_WEEK_IDS,
} from "./autopay.js";
import { DAILY_PRIZE_USDC, WEEKLY_PRIZE_USDC } from "./prizes.js";
import { resolvePrizeWalletAddress, getUsdcBalanceAtomic, solanaExplorerTxUrl } from "./wallet.js";
import { sendUsdcTransfer, confirmSignature } from "./transfer.js";

export const REFERRAL_BASE_USDC = Number(process.env.REFERRAL_BASE_USDC || 0.005);
export const REFERRAL_BONUS_USDC = Number(process.env.REFERRAL_BONUS_USDC || 0.01);
export const REFERRAL_QUALIFYING_DAYS = Number(process.env.REFERRAL_QUALIFYING_DAYS || 3);

export function referralDailyCapUsdc() {
  const n = Number(process.env.REFERRAL_DAILY_CAP_USDC || 1);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** on = send USDC; dry = queue/evaluate but never transfer; off = do not process queue. */
export function referralAutopayMode() {
  const raw = (process.env.REFERRAL_AUTOPAY || "dry").toLowerCase().trim();
  if (raw === "on" || raw === "1" || raw === "true" || raw === "yes") return "on";
  if (raw === "off" || raw === "0" || raw === "false" || raw === "no") return "off";
  return "dry";
}

function defaultPath() {
  const raw = (process.env.REFERRAL_DATA_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return path.join(ROOT, "data", "referrals.json");
}

function emptyDb() {
  return { version: 1, updatedAt: null, bindings: {}, payouts: [] };
}

function payoutId(kind, referred) {
  return `${kind}:${referred}`;
}

export class ReferralStore {
  constructor(filePath = defaultPath()) {
    this.filePath = filePath;
    this.db = emptyDb();
    this._load();
  }

  _load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this._persist();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.db = parsed && typeof parsed === "object" ? parsed : emptyDb();
      if (!this.db.bindings) this.db.bindings = {};
      if (!Array.isArray(this.db.payouts)) this.db.payouts = [];
    } catch {
      const bak = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        fs.renameSync(this.filePath, bak);
      } catch {
        /* ignore */
      }
      this.db = emptyDb();
      this._persist();
    }
  }

  _persist() {
    this.db.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.referrals.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2) + "\n", { mode: 0o640 });
    fs.renameSync(tmp, this.filePath);
  }

  getBinding(referred) {
    const w = String(referred || "").trim();
    return this.db.bindings[w] || null;
  }

  listBindings() {
    return Object.entries(this.db.bindings).map(([referred, row]) => ({ referred, ...row }));
  }

  setBinding({ referred, referrer, botName, boundAt }) {
    this.db.bindings[referred] = {
      referrer,
      botName: botName || null,
      boundAt: boundAt || new Date().toISOString(),
    };
    this._persist();
    return this.db.bindings[referred];
  }

  deleteBinding(referred) {
    const w = String(referred || "").trim();
    if (!this.db.bindings[w]) return false;
    delete this.db.bindings[w];
    this.db.payouts = this.db.payouts.filter((p) => {
      if (p.referred !== w) return true;
      if (p.paid || p.status === "paid" || p.status === "pending") return true;
      return false;
    });
    this._persist();
    return true;
  }

  getPayout(id) {
    return this.db.payouts.find((p) => p.id === id) || null;
  }

  listPayouts() {
    return this.db.payouts.slice();
  }

  upsertPayout(id, fields = {}) {
    const idx = this.db.payouts.findIndex((p) => p.id === id);
    const prev =
      idx >= 0
        ? this.db.payouts[idx]
        : {
            id,
            type: null,
            referred: null,
            referrer: null,
            amountUsdc: null,
            status: "queued",
            queuedAt: new Date().toISOString(),
            paidAt: null,
            pendingAt: null,
            paidUtcDay: null,
            txSignature: null,
            explorer: null,
            note: null,
            error: null,
            heldForPrizeReserve: false,
            deferredForDailyCap: false,
          };
    const next = { ...prev };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) next[k] = v;
    }
    if (idx >= 0) this.db.payouts[idx] = next;
    else this.db.payouts.push(next);
    this._persist();
    return next;
  }
}

let singleton = null;
export function getReferralStore() {
  if (!singleton) singleton = new ReferralStore();
  return singleton;
}

export function _setReferralStoreForTests(store) {
  singleton = store;
}

export function walletHasPrediction(arenaStore, wallet) {
  const w = String(wallet || "").trim();
  if (!w || !arenaStore) return false;
  for (const id of arenaStore.listRoundIds()) {
    const round = arenaStore.getRound(id);
    if (round?.predictions?.some((p) => p.wallet === w)) return true;
  }
  return false;
}

export function predictionUtcDays(arenaStore, wallet) {
  const w = String(wallet || "").trim();
  const days = new Set();
  if (!w || !arenaStore) return days;
  for (const id of arenaStore.listRoundIds()) {
    const round = arenaStore.getRound(id);
    for (const p of round?.predictions || []) {
      if (p.wallet !== w || !p.submittedAt) continue;
      days.add(utcDayKey(p.submittedAt));
    }
  }
  return days;
}

/**
 * Remaining USDC that must stay in the prize wallet for unpaid program prizes.
 * Skipped (no eligible winner) and already-paid prizes are not reserved.
 */
export function remainingPrizeReserveUsdc(arenaStore, now = new Date()) {
  if (!arenaStore) return 0;
  let reserve = 0;
  const start = new Date(`${AUTOPAY_DAILY_START}T00:00:00.000Z`);
  const end = new Date(`${AUTOPAY_DAILY_END}T00:00:00.000Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400_000) {
    const id = utcDayKey(new Date(t));
    const payout = arenaStore.getPayout("daily", id);
    if (payout?.paid || payout?.status === "paid" || payout?.status === "skipped") continue;
    reserve += DAILY_PRIZE_USDC;
  }
  for (const weekId of AUTOPAY_WEEK_IDS) {
    const payout = arenaStore.getPayout("weekly", weekId);
    if (payout?.paid || payout?.status === "paid" || payout?.status === "skipped") continue;
    reserve += WEEKLY_PRIZE_USDC;
  }
  void now;
  return reserve;
}

export function describeReferralProgram() {
  return {
    howToBind:
      "A new bot names a referrer once, on its first POST /v1/arena/predict, by sending optional `ref` (the referrer's payout wallet). The MCP arena_submit_prediction tool and the X-Pulse-Referrer header are also accepted. The binding never changes.",
    selfReferral: "ref equal to the bot's own wallet is rejected.",
    houseBots: "official-* house bots cannot refer and cannot be referred.",
    referrerMustBeEntrant: "The referrer must already have at least one Arena prediction on record.",
    base: {
      amountUsdc: REFERRAL_BASE_USDC,
      daysRequired: REFERRAL_QUALIFYING_DAYS,
      text:
        `$${REFERRAL_BASE_USDC} USDC to the referrer once the referred bot has both a /v1/pulse call ` +
        `(free counts; X-Pulse-Client-Id or payer wallet = payout wallet) and an Arena prediction ` +
        `on ${REFERRAL_QUALIFYING_DAYS} distinct UTC days (not necessarily consecutive).`,
    },
    bonus: {
      amountUsdc: REFERRAL_BONUS_USDC,
      text:
        `An extra $${REFERRAL_BONUS_USDC} USDC to the referrer the first time the referred bot makes a paid x402 GET /v1/pulse call (payer wallet or X-Pulse-Client-Id matches the payout wallet).`,
    },
    caps: {
      dailyCapUsdc: referralDailyCapUsdc(),
      overflow: "Amounts over the daily cap queue FIFO to the next UTC day; they are not dropped.",
      prizeReserve:
        "Referral payouts never spend the USDC reserved for remaining daily and weekly prizes. If the wallet balance minus that reserve cannot cover a payout, it stays queued and is flagged in the admin export.",
    },
    oncePerType: "Each referred wallet pays its referrer at most once per reward type (base, bonus).",
    autopay:
      "Paid automatically on-chain from the public prize wallet (same path as prizes). REFERRAL_AUTOPAY=dry|on|off (default dry).",
  };
}

function referrerLooksHouse(arenaStore, wallet) {
  const w = String(wallet || "").trim();
  if (!w || !arenaStore) return false;
  for (const id of arenaStore.listRoundIds()) {
    const round = arenaStore.getRound(id);
    if (round?.predictions?.some((p) => p.wallet === w && (p.house || isHouseBotName(p.botName)))) {
      return true;
    }
  }
  return false;
}

export function bindReferral({
  referred,
  referrer,
  botName,
  arenaStore,
  store = getReferralStore(),
} = {}) {
  const wallet = String(referred || "").trim();
  const ref = String(referrer || "").trim();
  if (!ref) return { bound: false, reason: "no_ref" };
  if (store.getBinding(wallet)) {
    return { bound: false, already: true, binding: store.getBinding(wallet), reason: "already_bound" };
  }
  if (!isValidSolanaPubkey(ref)) {
    throw Object.assign(new Error("ref must be a valid Solana payout wallet"), {
      code: "invalid_referrer",
      status: 400,
    });
  }
  if (ref === wallet) {
    throw Object.assign(new Error("self-referral is not allowed (ref cannot be your own wallet)"), {
      code: "self_referral",
      status: 400,
    });
  }
  if (isHouseEntrant({ wallet, botName }) || isHouseWallet(wallet)) {
    throw Object.assign(new Error("house bots cannot be referred"), {
      code: "house_not_referable",
      status: 400,
    });
  }
  if (isHouseWallet(ref) || isHouseEntrant({ wallet: ref }) || referrerLooksHouse(arenaStore, ref)) {
    throw Object.assign(new Error("house bots cannot refer"), {
      code: "house_cannot_refer",
      status: 400,
    });
  }
  if (!walletHasPrediction(arenaStore, ref)) {
    throw Object.assign(
      new Error("referrer must already have at least one Arena prediction on record"),
      { code: "referrer_not_entrant", status: 400 },
    );
  }
  const binding = store.setBinding({ referred: wallet, referrer: ref, botName });
  return { bound: true, binding };
}

export function qualifyingReferralDays(arenaStore, wallet, usage = getPulseUsageStore()) {
  const predDays = predictionUtcDays(arenaStore, wallet);
  const out = [];
  for (const day of [...predDays].sort()) {
    if (usage?.matches?.(day, wallet)) out.push(day);
  }
  return out;
}

export function referredHasPaidPulse(wallet, usage = getPulseUsageStore()) {
  const w = String(wallet || "").trim();
  if (!w || !usage?.db?.days) return false;
  for (const bucket of Object.values(usage.db.days)) {
    const client = bucket?.clients?.[w];
    if (client && client.kind === "paid") return true;
    const payer = bucket?.payers?.[w];
    if (payer) return true;
  }
  return false;
}

function enqueueIfNeeded(store, { kind, referred, referrer, amountUsdc }) {
  const id = payoutId(kind, referred);
  const existing = store.getPayout(id);
  if (existing) return existing;
  return store.upsertPayout(id, {
    type: kind,
    referred,
    referrer,
    amountUsdc,
    status: "queued",
    queuedAt: new Date().toISOString(),
    note: kind === "base" ? "base_reward_earned" : "bonus_reward_earned",
  });
}

/** Recompute qualifying days and enqueue newly earned rewards. */
export function refreshReferralProgress({
  wallet,
  arenaStore,
  usage = getPulseUsageStore(),
  store = getReferralStore(),
} = {}) {
  const w = String(wallet || "").trim();
  const binding = store.getBinding(w);
  if (!binding) return null;
  const days = qualifyingReferralDays(arenaStore, w, usage);
  if (days.length >= REFERRAL_QUALIFYING_DAYS) {
    enqueueIfNeeded(store, {
      kind: "base",
      referred: w,
      referrer: binding.referrer,
      amountUsdc: REFERRAL_BASE_USDC,
    });
  }
  if (referredHasPaidPulse(w, usage)) {
    enqueueIfNeeded(store, {
      kind: "bonus",
      referred: w,
      referrer: binding.referrer,
      amountUsdc: REFERRAL_BONUS_USDC,
    });
  }
  return getReferralView(w, { arenaStore, usage, store });
}

export function getReferralView(wallet, { arenaStore, usage = getPulseUsageStore(), store = getReferralStore() } = {}) {
  const w = String(wallet || "").trim();
  const binding = store.getBinding(w);
  const program = describeReferralProgram();
  if (!binding) {
    return {
      referrer: null,
      daysCompleted: 0,
      daysRequired: REFERRAL_QUALIFYING_DAYS,
      qualifyingDays: [],
      base: { earned: false, amountUsdc: REFERRAL_BASE_USDC, status: null },
      bonus: { earned: false, amountUsdc: REFERRAL_BONUS_USDC, status: null },
      howTo: program.howToBind,
    };
  }
  const days = arenaStore ? qualifyingReferralDays(arenaStore, w, usage) : [];
  const base = store.getPayout(payoutId("base", w));
  const bonus = store.getPayout(payoutId("bonus", w));
  return {
    referrer: binding.referrer,
    boundAt: binding.boundAt,
    daysCompleted: days.length,
    daysRequired: REFERRAL_QUALIFYING_DAYS,
    qualifyingDays: days,
    base: {
      earned: Boolean(base),
      amountUsdc: REFERRAL_BASE_USDC,
      status: base?.status || (days.length >= REFERRAL_QUALIFYING_DAYS ? "queued" : "incomplete"),
      paidUtcDay: base?.paidUtcDay || null,
      txSignature: base?.txSignature || null,
      explorer: base?.explorer || null,
      heldForPrizeReserve: Boolean(base?.heldForPrizeReserve),
    },
    bonus: {
      earned: Boolean(bonus),
      amountUsdc: REFERRAL_BONUS_USDC,
      status: bonus?.status || (referredHasPaidPulse(w, usage) ? "queued" : "incomplete"),
      paidUtcDay: bonus?.paidUtcDay || null,
      txSignature: bonus?.txSignature || null,
      explorer: bonus?.explorer || null,
      heldForPrizeReserve: Boolean(bonus?.heldForPrizeReserve),
    },
  };
}

export function getReferrerDashboard(referrer, { arenaStore, usage = getPulseUsageStore(), store = getReferralStore() } = {}) {
  const w = String(referrer || "").trim();
  if (!w) {
    throw Object.assign(new Error("wallet required"), { code: "missing_wallet", status: 400 });
  }
  const referred = [];
  let earnedUsdc = 0;
  let paidUsdc = 0;
  let queuedUsdc = 0;
  for (const row of store.listBindings()) {
    if (row.referrer !== w) continue;
    const view = getReferralView(row.referred, { arenaStore, usage, store });
    const earnings = [];
    for (const kind of ["base", "bonus"]) {
      const p = view[kind];
      if (!p?.earned && p?.status === "incomplete") continue;
      if (p?.earned || (p?.status && p.status !== "incomplete")) {
        earnings.push({ type: kind, amountUsdc: p.amountUsdc, status: p.status, explorer: p.explorer });
        earnedUsdc += Number(p.amountUsdc) || 0;
        if (p.status === "paid") paidUsdc += Number(p.amountUsdc) || 0;
        if (p.status === "queued" || p.status === "pending" || p.heldForPrizeReserve) {
          queuedUsdc += Number(p.amountUsdc) || 0;
        }
      }
    }
    referred.push({
      wallet: row.referred,
      botName: row.botName || null,
      boundAt: row.boundAt,
      daysCompleted: view.daysCompleted,
      daysRequired: view.daysRequired,
      earnings,
      base: view.base,
      bonus: view.bonus,
    });
  }
  return {
    wallet: w,
    referredCount: referred.length,
    referred,
    totals: { earnedUsdc, paidUsdc, queuedUsdc },
    program: describeReferralProgram(),
  };
}

function referralSpendForDay(store, dayKey) {
  let sum = 0;
  for (const p of store.listPayouts()) {
    if (!(p.status === "paid" || p.status === "pending") && !p.paid) continue;
    const day = p.paidUtcDay || (p.paidAt ? utcDayKey(p.paidAt) : null) || (p.pendingAt ? utcDayKey(p.pendingAt) : null);
    if (day !== dayKey) continue;
    sum += Number(p.amountUsdc) || 0;
  }
  return sum;
}

/**
 * Process the referral payout queue. Default mode is dry-run (no USDC sent).
 */
export async function processReferralPayouts(arenaStore, deps = {}) {
  const store = deps.store || getReferralStore();
  const usage = deps.usage || getPulseUsageStore();
  const mode = deps.mode || referralAutopayMode();
  const now = deps.now || new Date();
  const dayKey = utcDayKey(now);
  const cap = deps.dailyCapUsdc ?? referralDailyCapUsdc();
  const reserve =
    deps.prizeReserveUsdc !== undefined
      ? deps.prizeReserveUsdc
      : remainingPrizeReserveUsdc(arenaStore, now);
  const results = [];

  for (const row of store.listBindings()) {
    refreshReferralProgress({ wallet: row.referred, arenaStore, usage, store });
  }

  if (mode === "off") {
    return { ok: true, mode, prizeReserveUsdc: reserve, dailyCapUsdc: cap, results };
  }

  const getBalance =
    deps.getBalance ||
    (async () => {
      const addr = resolvePrizeWalletAddress();
      if (!addr) return { ui: 0, amount: 0n };
      return getUsdcBalanceAtomic(addr);
    });
  const sendFn = deps.sendFn || sendUsdcTransfer;
  const confirm = deps.confirm || confirmSignature;

  const queued = store
    .listPayouts()
    .filter((p) => p.status === "queued" || p.status === "held_reserve" || p.status === "pending")
    .sort((a, b) => String(a.queuedAt || "").localeCompare(String(b.queuedAt || "")));

  let spend = referralSpendForDay(store, dayKey);
  let capBlocked = false;

  for (const item of queued) {
    if (item.status === "pending" && item.txSignature && mode === "on") {
      const st = await confirm(item.txSignature, { attempts: 8, delayMs: 400 });
      if (st === "confirmed") {
        store.upsertPayout(item.id, {
          paid: true,
          status: "paid",
          paidAt: item.paidAt || now.toISOString(),
          paidUtcDay: item.paidUtcDay || dayKey,
          explorer: item.explorer || solanaExplorerTxUrl(item.txSignature),
          note: "confirmed after restart",
          error: null,
          heldForPrizeReserve: false,
          deferredForDailyCap: false,
        });
        results.push({ ok: true, already: true, id: item.id });
        continue;
      }
      if (st === "failed") {
        store.upsertPayout(item.id, {
          status: "queued",
          txSignature: null,
          explorer: null,
          pendingAt: null,
          note: "previous tx failed; re-queued",
          error: "transfer_failed",
        });
        continue;
      }
      results.push({ ok: true, pending: true, id: item.id });
      continue;
    }

    const amount = Number(item.amountUsdc);
    if (!Number.isFinite(amount) || amount <= 0 || !isValidSolanaPubkey(item.referrer)) {
      store.upsertPayout(item.id, { status: "skipped", note: "invalid_payout", error: "invalid_payout" });
      results.push({ ok: false, id: item.id, reason: "invalid_payout" });
      continue;
    }

    if (capBlocked || spend + amount > cap + 1e-12) {
      capBlocked = true;
      store.upsertPayout(item.id, {
        status: "queued",
        deferredForDailyCap: true,
        heldForPrizeReserve: false,
        note: `deferred_daily_cap spend=${spend} cap=${cap} need=${amount}`,
      });
      results.push({ ok: false, id: item.id, reason: "deferred_daily_cap", spend, cap, amount });
      continue;
    }

    let balUi = 0;
    try {
      const bal = await getBalance();
      balUi = Number(bal.ui);
    } catch (err) {
      store.upsertPayout(item.id, {
        status: "queued",
        heldForPrizeReserve: true,
        note: `balance_check_failed: ${String(err?.message || err).slice(0, 120)}`,
        error: "balance_check_failed",
      });
      results.push({ ok: false, id: item.id, reason: "balance_check_failed" });
      continue;
    }
    const available = balUi - reserve;
    if (available + 1e-9 < amount) {
      store.upsertPayout(item.id, {
        status: "held_reserve",
        heldForPrizeReserve: true,
        deferredForDailyCap: false,
        note: `held_for_prize_reserve available=${available} reserve=${reserve} have=${balUi} need=${amount}`,
        error: "held_for_prize_reserve",
      });
      results.push({
        ok: false,
        id: item.id,
        reason: "held_for_prize_reserve",
        available,
        reserve,
        have: balUi,
        amount,
      });
      continue;
    }

    if (mode === "dry") {
      store.upsertPayout(item.id, {
        status: "queued",
        deferredForDailyCap: false,
        heldForPrizeReserve: false,
        note: `dry_run would pay ${amount} USDC to referrer on ${dayKey}; REFERRAL_AUTOPAY=dry`,
        error: null,
      });
      results.push({ ok: true, dryRun: true, id: item.id, amountUsdc: amount, referrer: item.referrer });
      // Do not mark spend or paid — money did not move, so the cap is not consumed.
      continue;
    }

    store.upsertPayout(item.id, {
      status: "pending",
      pendingAt: now.toISOString(),
      paidUtcDay: dayKey,
      heldForPrizeReserve: false,
      deferredForDailyCap: false,
      note: "sending",
    });
    try {
      const result = await sendFn({ recipient: item.referrer, amountUsdc: amount });
      const confirmation = result.confirmation || "confirmed";
      if (confirmation === "unknown") {
        store.upsertPayout(item.id, {
          status: "pending",
          txSignature: result.signature,
          explorer: result.explorer || solanaExplorerTxUrl(result.signature),
          note: "submitted; awaiting confirmation",
        });
        spend += amount;
        results.push({ ok: true, pending: true, id: item.id });
        continue;
      }
      store.upsertPayout(item.id, {
        paid: true,
        status: "paid",
        paidAt: new Date().toISOString(),
        paidUtcDay: dayKey,
        txSignature: result.signature,
        explorer: result.explorer || solanaExplorerTxUrl(result.signature),
        note: "automatic referral payout",
        error: null,
      });
      spend += amount;
      console.log(
        JSON.stringify({
          event: "arena_referral_paid",
          id: item.id,
          type: item.type,
          amountUsdc: amount,
          referrer: item.referrer,
          referred: item.referred,
          signature: result.signature,
        }),
      );
      results.push({ ok: true, id: item.id, amountUsdc: amount });
    } catch (err) {
      const code = err?.code || "transfer_error";
      store.upsertPayout(item.id, {
        status: "queued",
        pendingAt: null,
        paidUtcDay: null,
        txSignature: err?.signature || null,
        note: String(err?.message || err).slice(0, 200),
        error: code,
      });
      results.push({ ok: false, id: item.id, reason: code });
    }
  }

  return {
    ok: true,
    mode,
    prizeReserveUsdc: reserve,
    dailyCapUsdc: cap,
    spentTodayUsdc: spend,
    results,
  };
}

export function referralAdminSummary({ arenaStore, store = getReferralStore(), usage = getPulseUsageStore(), now = new Date() } = {}) {
  const payouts = store.listPayouts();
  const paid = payouts.filter((p) => p.status === "paid" || p.paid);
  const queued = payouts.filter((p) => p.status === "queued" || p.status === "pending");
  const held = payouts.filter((p) => p.heldForPrizeReserve || p.status === "held_reserve");
  const deferred = payouts.filter((p) => p.deferredForDailyCap);
  const sum = (rows) => rows.reduce((s, p) => s + (Number(p.amountUsdc) || 0), 0);
  return {
    mode: referralAutopayMode(),
    dailyCapUsdc: referralDailyCapUsdc(),
    baseUsdc: REFERRAL_BASE_USDC,
    bonusUsdc: REFERRAL_BONUS_USDC,
    qualifyingDays: REFERRAL_QUALIFYING_DAYS,
    prizeReserveUsdc: remainingPrizeReserveUsdc(arenaStore, now),
    totals: {
      bindings: store.listBindings().length,
      payouts: payouts.length,
      paid: paid.length,
      queued: queued.length,
      heldForPrizeReserve: held.length,
      deferredForDailyCap: deferred.length,
      earnedUsdc: sum(payouts),
      paidUsdc: sum(paid),
      queuedUsdc: sum(queued),
    },
    payouts,
    heldForPrizeReserve: held,
    deferredForDailyCap: deferred,
    program: describeReferralProgram(),
  };
}
