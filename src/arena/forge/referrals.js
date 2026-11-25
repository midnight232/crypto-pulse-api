/**
 * Non-cash referral progress for Pulse Forge.
 * A referred bot that posts an Arena prediction on 3 distinct UTC days
 * credits the referrer with 7 Pro days (a badge / ledger only).
 * This module never enqueues or sends USDC and does not call autopay.
 */
import { predictionUtcDays, getReferralStore } from "../referrals.js";

export const PRO_DAY_PLAY_DAYS = 3;
export const PRO_DAY_CREDITS = 7;

const NOTE =
  "Non-cash Pulse Forge credit for the referrer after this bot has an Arena prediction on 3 distinct UTC days. It does not send USDC and does not change referral autopay.";

export function nonCashForReferred(wallet, { arenaStore, referralStore = getReferralStore() } = {}) {
  const w = String(wallet || "").trim();
  const binding = w ? referralStore.getBinding(w) : null;
  const days = arenaStore && w ? [...predictionUtcDays(arenaStore, w)].sort() : [];
  const qualified = Boolean(binding) && days.length >= PRO_DAY_PLAY_DAYS;
  return {
    cash: false,
    kind: "pro_days",
    bound: Boolean(binding),
    referrer: binding?.referrer || null,
    playDays: days.length,
    playDaysRequired: PRO_DAY_PLAY_DAYS,
    playDayList: days,
    qualified,
    proDayCredits: qualified ? PRO_DAY_CREDITS : 0,
    proDayCreditsOnQualify: PRO_DAY_CREDITS,
    badges: qualified ? [{ id: "pro-days", label: "7 Pro-day credits (non-cash)" }] : [],
    note: NOTE,
  };
}

export function nonCashReferrerSummary(referrer, { arenaStore, referralStore = getReferralStore() } = {}) {
  const w = String(referrer || "").trim();
  const referred = [];
  let proDayCredits = 0;
  for (const row of referralStore.listBindings()) {
    if (row.referrer !== w) continue;
    const progress = nonCashForReferred(row.referred, { arenaStore, referralStore });
    proDayCredits += progress.proDayCredits;
    referred.push({
      wallet: row.referred,
      botName: row.botName || null,
      ...progress,
    });
  }
  return {
    cash: false,
    kind: "pro_days",
    playDaysRequired: PRO_DAY_PLAY_DAYS,
    proDayCreditsOnQualify: PRO_DAY_CREDITS,
    proDayCredits,
    qualifiedReferrals: referred.filter((r) => r.qualified).length,
    referred,
    note:
      "Non-cash Pro-day credits: 7 per referred bot that plays on 3 distinct UTC days. Existing USDC referral rewards and autopay are unchanged.",
  };
}
