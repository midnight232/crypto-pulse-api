/**
 * Automatic Arena prize payouts from the dedicated prize wallet.
 *
 * Guardrails:
 * - ARENA_AUTOPAY=off kill switch
 * - Max single payout $10; max $11 USDC total per UTC calendar day
 * - Idempotent: pending → verify on-chain → paid; never double-pay
 * - Insufficient funds → record unpaid/owed (no throw to scorer)
 * - Program window: daily rounds 2026-11-03..2026-11-23; weekly weeks 2026-11-02, 2026-11-09, and 2026-11-16
 */
import { base58 } from "@scure/base";
import {
  DAILY_PRIZE_USDC,
  WEEKLY_PRIZE_USDC,
  weekBounds,
  FIRST_WEEK_START,
  AUTOPAY_DAILY_START,
  AUTOPAY_DAILY_END,
  AUTOPAY_WEEK_IDS,
} from "./prizes.js";
import { parseRoundId } from "./rounds.js";
import { buildLeaderboard } from "./scoring.js";
import { buildWeeklyLeaderboard } from "./weekly.js";
import { resolvePrizeWalletAddress, getUsdcBalanceAtomic, solanaExplorerTxUrl } from "./wallet.js";
import { sendUsdcTransfer, confirmSignature } from "./transfer.js";

export { AUTOPAY_DAILY_START, AUTOPAY_DAILY_END, AUTOPAY_WEEK_IDS };

function dailyBoard(store, roundId) {
  const round = store.getRound(roundId);
  if (!round) return { status: null, ranking: [], prizeWinner: null };
  const { rows, prizeWinner } = buildLeaderboard(round);
  return { status: round.status, ranking: rows, prizeWinner: prizeWinner || null, scoredAt: round.scoredAt };
}

export const MAX_SINGLE_PAYOUT_USDC = 10;
export const MAX_DAILY_TOTAL_USDC = 11;

export function autopayEnabled() {
  const raw = (process.env.ARENA_AUTOPAY || "on").toLowerCase().trim();
  return raw === "on" || raw === "1" || raw === "true" || raw === "yes";
}

export function isValidSolanaPubkey(wallet) {
  try {
    const bytes = base58.decode(String(wallet || "").trim());
    if (bytes.length !== 32) return false;
    if (bytes.every((b) => b === 0)) return false;
    return true;
  } catch {
    return false;
  }
}

export function utcDayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}

export function dailyRoundInAutopayWindow(roundId) {
  return roundId >= AUTOPAY_DAILY_START && roundId <= AUTOPAY_DAILY_END;
}

export function weeklyInAutopayWindow(weekId) {
  return AUTOPAY_WEEK_IDS.includes(weekId);
}

/** Pure helper: how much has already been committed today (paid or pending). */
export function sumCommittedUsdcForUtcDay(payouts, dayKey) {
  let sum = 0;
  for (const bucket of [payouts.daily || {}, payouts.weekly || {}]) {
    for (const row of Object.values(bucket)) {
      if (!row) continue;
      const day = row.paidUtcDay || (row.paidAt ? utcDayKey(row.paidAt) : null) || (row.pendingAt ? utcDayKey(row.pendingAt) : null);
      if (day !== dayKey) continue;
      if (row.status === "paid" || row.status === "pending" || row.paid) {
        sum += Number(row.amountUsdc) || 0;
      }
    }
  }
  return sum;
}

/**
 * Decide whether a payout may proceed (caps / window / wallet). Does not touch chain.
 */
export function evaluatePayoutGuardrails({
  type,
  id,
  amountUsdc,
  wallet,
  existing,
  payoutsSnapshot,
  now = new Date(),
  enabled = true,
}) {
  if (existing?.paid || existing?.status === "paid") {
    return { ok: false, reason: "already_paid", status: "paid" };
  }
  if (existing?.status === "pending" && existing?.txSignature) {
    return { ok: false, reason: "pending_verify", status: "pending" };
  }
  if (!enabled) {
    return { ok: false, reason: "autopay_disabled", status: "disabled" };
  }
  if (type === "daily" && !dailyRoundInAutopayWindow(id)) {
    return { ok: false, reason: "outside_program_window", status: "outside_window" };
  }
  if (type === "weekly" && !weeklyInAutopayWindow(id)) {
    return { ok: false, reason: "outside_program_window", status: "outside_window" };
  }
  if (!wallet || !isValidSolanaPubkey(wallet)) {
    return { ok: false, reason: "invalid_winner_wallet", status: "skipped" };
  }
  const amount = Number(amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "invalid_amount", status: "skipped" };
  }
  if (amount > MAX_SINGLE_PAYOUT_USDC) {
    return { ok: false, reason: "exceeds_single_cap", status: "skipped" };
  }
  const dayKey = utcDayKey(now);
  const committed = sumCommittedUsdcForUtcDay(payoutsSnapshot, dayKey);
  // If this id already has a pending/paid row counted, don't double-count when retrying unpaid.
  const alreadyCounted =
    existing &&
    (existing.status === "pending" || existing.status === "paid" || existing.paid) &&
    (existing.paidUtcDay === dayKey ||
      (existing.paidAt && utcDayKey(existing.paidAt) === dayKey) ||
      (existing.pendingAt && utcDayKey(existing.pendingAt) === dayKey));
  const nextTotal = committed + (alreadyCounted ? 0 : amount);
  if (nextTotal > MAX_DAILY_TOTAL_USDC + 1e-9) {
    return { ok: false, reason: "exceeds_daily_cap", status: "skipped", committed, nextTotal };
  }
  return { ok: true, amount, dayKey };
}

export function weekReadyForPayout(store, weekId, now = new Date()) {
  const { roundIds, endRoundId } = weekBounds(weekId);
  const endMeta = parseRoundId(endRoundId);
  if (now.getTime() < new Date(endMeta.closeAt).getTime()) return false;
  for (const id of roundIds) {
    const r = store.getRound(id);
    if (!r) continue;
    try {
      const meta = parseRoundId(id);
      if (
        now.getTime() >= new Date(meta.closeAt).getTime() &&
        r.status !== "scored" &&
        (r.predictions?.length || 0) > 0
      ) {
        return false;
      }
    } catch {
      /* ignore */
    }
  }
  return true;
}

async function reconcilePending(store, type, id, existing, { confirm = confirmSignature } = {}) {
  if (existing?.status !== "pending" || !existing?.txSignature) return existing;
  const st = await confirm(existing.txSignature, { attempts: 8, delayMs: 400 });
  if (st === "confirmed") {
    return store.setPayout(type, id, {
      paid: true,
      status: "paid",
      paidAt: existing.paidAt || new Date().toISOString(),
      txSignature: existing.txSignature,
      explorer: existing.explorer || solanaExplorerTxUrl(existing.txSignature),
      amountUsdc: existing.amountUsdc,
      wallet: existing.wallet,
      botName: existing.botName,
      note: existing.note || "confirmed after restart",
      paidUtcDay: existing.paidUtcDay || utcDayKey(),
    });
  }
  if (st === "failed") {
    return store.setPayout(type, id, {
      paid: false,
      status: "unpaid",
      txSignature: null,
      explorer: null,
      pendingAt: null,
      note: `previous tx failed (${existing.txSignature.slice(0, 8)}…)`,
      amountUsdc: existing.amountUsdc,
      wallet: existing.wallet,
      botName: existing.botName,
      error: "transfer_failed",
    });
  }
  // unknown — leave pending
  return existing;
}

/**
 * Attempt one prize payout. `sendFn` injectable for tests / dry-run.
 */
export async function attemptPayout(store, {
  type,
  id,
  amountUsdc,
  wallet,
  botName,
  score,
  sendFn = sendUsdcTransfer,
  confirm = confirmSignature,
  getBalance = async () => {
    const addr = resolvePrizeWalletAddress();
    if (!addr) return { ui: 0, amount: 0n };
    return getUsdcBalanceAtomic(addr);
  },
  now = new Date(),
  enabled = autopayEnabled(),
} = {}) {
  let existing = store.getPayout(type, id);
  if (existing?.status === "pending" && existing?.txSignature) {
    existing = await reconcilePending(store, type, id, existing, { confirm });
    if (existing?.paid || existing?.status === "paid") {
      return { ok: true, already: true, type, id, payout: existing };
    }
  }

  const guard = evaluatePayoutGuardrails({
    type,
    id,
    amountUsdc,
    wallet,
    existing,
    payoutsSnapshot: store.listPayouts(),
    now,
    enabled,
  });

  if (!guard.ok) {
    if (guard.reason === "already_paid" || guard.reason === "pending_verify") {
      return { ok: true, already: true, type, id, payout: existing, reason: guard.reason };
    }
    const row = store.setPayout(type, id, {
      paid: false,
      status: guard.status,
      amountUsdc,
      wallet,
      botName: botName || null,
      score: score ?? null,
      note: guard.reason,
      error: guard.reason,
    });
    return { ok: false, type, id, reason: guard.reason, payout: row };
  }

  // Balance check before marking pending
  let bal;
  try {
    bal = await getBalance();
  } catch (err) {
    const row = store.setPayout(type, id, {
      paid: false,
      status: "insufficient",
      amountUsdc: guard.amount,
      wallet,
      botName: botName || null,
      score: score ?? null,
      note: `balance_check_failed: ${String(err?.message || err)}`,
      error: "balance_check_failed",
    });
    return { ok: false, type, id, reason: "balance_check_failed", payout: row };
  }
  if (Number(bal.ui) + 1e-9 < guard.amount) {
    const row = store.setPayout(type, id, {
      paid: false,
      status: "insufficient",
      amountUsdc: guard.amount,
      wallet,
      botName: botName || null,
      score: score ?? null,
      note: `insufficient_usdc have=${bal.ui} need=${guard.amount}`,
      error: "insufficient_usdc",
    });
    return { ok: false, type, id, reason: "insufficient_usdc", payout: row };
  }

  const pendingAt = now.toISOString();
  store.setPayout(type, id, {
    paid: false,
    status: "pending",
    pendingAt,
    paidUtcDay: guard.dayKey,
    amountUsdc: guard.amount,
    wallet,
    botName: botName || null,
    score: score ?? null,
    note: "sending",
    txSignature: null,
    explorer: null,
  });

  try {
    const result = await sendFn({ recipient: wallet, amountUsdc: guard.amount });
    const paidAt = new Date().toISOString();
    const confirmation = result.confirmation || "confirmed";
    if (confirmation === "unknown") {
      const row = store.setPayout(type, id, {
        paid: false,
        status: "pending",
        pendingAt,
        paidUtcDay: guard.dayKey,
        amountUsdc: guard.amount,
        wallet,
        botName: botName || null,
        score: score ?? null,
        txSignature: result.signature,
        explorer: result.explorer || solanaExplorerTxUrl(result.signature),
        note: "submitted; awaiting confirmation",
      });
      return { ok: true, pending: true, type, id, payout: row };
    }
    const row = store.setPayout(type, id, {
      paid: true,
      status: "paid",
      paidAt,
      pendingAt,
      paidUtcDay: guard.dayKey,
      amountUsdc: guard.amount,
      wallet,
      botName: botName || null,
      score: score ?? null,
      txSignature: result.signature,
      explorer: result.explorer || solanaExplorerTxUrl(result.signature),
      note: "automatic on-chain payout",
      error: null,
    });
    console.log(
      JSON.stringify({
        event: "arena_autopay_paid",
        type,
        id,
        amountUsdc: guard.amount,
        wallet,
        signature: result.signature,
      }),
    );
    return { ok: true, type, id, payout: row };
  } catch (err) {
    const code = err?.code || "transfer_error";
    const status = code === "insufficient_usdc" ? "insufficient" : "unpaid";
    const row = store.setPayout(type, id, {
      paid: false,
      status,
      pendingAt: null,
      paidUtcDay: null,
      amountUsdc: guard.amount,
      wallet,
      botName: botName || null,
      score: score ?? null,
      txSignature: err?.signature || null,
      explorer: err?.signature ? solanaExplorerTxUrl(err.signature) : null,
      note: String(err?.message || err).slice(0, 200),
      error: code,
    });
    console.error(
      JSON.stringify({
        event: "arena_autopay_error",
        type,
        id,
        error: String(err?.message || err),
        code,
      }),
    );
    return { ok: false, type, id, reason: code, payout: row };
  }
}

export async function processAutopay(store, deps = {}) {
  const results = [];
  if (!resolvePrizeWalletAddress() && deps.requireWallet !== false) {
    // Still allow dry-run tests to inject sendFn without a configured address
    if (!deps.sendFn) {
      return { ok: false, reason: "prize_wallet_unconfigured", results };
    }
  }

  // Daily
  for (const roundId of store.listRoundIds().sort()) {
    if (!dailyRoundInAutopayWindow(roundId)) continue;
    const board = dailyBoard(store, roundId);
    if (board.status !== "scored") continue;
    // House bots are never paid: use prizeWinner (first prizeEligible), not raw #1.
    const winner = board.prizeWinner || board.ranking?.find((r) => r.prizeEligible !== false && !r.house) || null;
    if (!winner?.wallet || winner.house || winner.prizeEligible === false) {
      const existing = store.getPayout("daily", roundId);
      if (!existing?.status || existing.status === "unpaid") {
        store.setPayout("daily", roundId, {
          paid: false,
          status: "skipped",
          amountUsdc: DAILY_PRIZE_USDC,
          note: "no_eligible_winner",
        });
      }
      continue;
    }
    results.push(
      await attemptPayout(store, {
        type: "daily",
        id: roundId,
        amountUsdc: DAILY_PRIZE_USDC,
        wallet: winner.wallet,
        botName: winner.botName,
        score: winner.avgAbsPctError,
        ...deps,
      }),
    );
  }

  // Weekly
  for (const weekId of AUTOPAY_WEEK_IDS) {
    if (weekId < FIRST_WEEK_START) continue;
    if (!weekReadyForPayout(store, weekId, deps.now || new Date())) continue;
    const board = buildWeeklyLeaderboard(store, weekId);
    const winner = board.prizeWinner || board.winner;
    if (!winner?.wallet || winner.avgAbsPctError == null || winner.house || winner.prizeEligible === false) {
      const existing = store.getPayout("weekly", weekId);
      if (!existing?.status || existing.status === "unpaid") {
        store.setPayout("weekly", weekId, {
          paid: false,
          status: "skipped",
          amountUsdc: WEEKLY_PRIZE_USDC,
          note: "no_eligible_winner",
        });
      }
      continue;
    }
    results.push(
      await attemptPayout(store, {
        type: "weekly",
        id: weekId,
        amountUsdc: WEEKLY_PRIZE_USDC,
        wallet: winner.wallet,
        botName: winner.botName,
        score: winner.avgAbsPctError,
        ...deps,
      }),
    );
  }

  return { ok: true, results };
}

/** Flatten payout history for public pages (newest first). */
export function listPublicPayoutHistory(store, { limit = 50 } = {}) {
  const all = [];
  const { daily, weekly } = store.listPayouts();
  for (const [roundId, row] of Object.entries(daily || {})) {
    all.push({ type: "daily", id: roundId, ...row });
  }
  for (const [weekId, row] of Object.entries(weekly || {})) {
    all.push({ type: "weekly", id: weekId, ...row });
  }
  all.sort((a, b) => {
    const ta = a.paidAt || a.pendingAt || "";
    const tb = b.paidAt || b.pendingAt || "";
    return tb.localeCompare(ta);
  });
  return all.slice(0, limit);
}
