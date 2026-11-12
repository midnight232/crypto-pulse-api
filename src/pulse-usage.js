/**
 * Persistent log of successful GET /v1/pulse calls, keyed by UTC date,
 * client id, and payer wallet. Used for Arena prize eligibility.
 *
 * Identity: an Arena entry is the payout wallet (the `wallet` field on
 * POST /v1/arena/predict). There is no separate entry id.
 *
 * A call counts for that wallet on a UTC day when:
 *   - X-Pulse-Client-Id equals the payout wallet (free or paid), or
 *   - a paid x402 call's payer wallet equals the payout wallet.
 *
 * Qualifying UTC day for daily round YYYY-MM-DD (settlement midnight /
 * closeAt) is the previous UTC calendar date — the 24 hours that end at
 * closeAt. Example: round 2026-11-13 (closes 00:00 UTC 13 Nov) requires a
 * call sometime on 2026-11-12 UTC.
 *
 * The rule is enforced starting with that 2026-11-13 round. Earlier closed
 * rounds are unchanged.
 */
import fs from "fs";
import path from "path";
import { getBase64Encoder, getCompiledTransactionMessageDecoder, getInstructionsFromCompiledTransactionMessage, getTransactionDecoder } from "@solana/kit";
import { ROOT } from "./config.js";
import { freePulseClientId } from "./free-pulse.js";

const DEFAULT_PATH = path.join(ROOT, "data", "pulse-usage.json");
const DEFAULT_FREE_PATH = path.join(ROOT, "data", "free-pulse.json");
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNrdVxiPYxYaaBhnfgnYzQHnVaFa13fhZxP";
const RETAIN_DAYS = Number(process.env.PULSE_USAGE_RETAIN_DAYS || 180);
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** First daily round id (settlement date) the pulse-call rule applies to. */
export const PULSE_RULE_FIRST_ROUND = "2026-11-13";
export const NO_PULSE_REASON = "not prize-eligible: no /v1/pulse call";

export function utcDayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}

export function resolvePulseUsagePath() {
  const raw = (process.env.PULSE_USAGE_DATA_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return DEFAULT_PATH;
}

function emptyDb() {
  return { version: 1, updatedAt: null, days: {} };
}

/** UTC calendar date that ends at the round's closeAt (00:00 UTC on roundId). */
export function pulseUsageDayForRound(roundId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(roundId || ""))) return null;
  const close = new Date(`${roundId}T00:00:00.000Z`);
  if (Number.isNaN(close.getTime())) return null;
  return utcDayKey(new Date(close.getTime() - 1));
}

export function pulseRuleApplies(roundId) {
  return String(roundId || "") >= PULSE_RULE_FIRST_ROUND;
}

function looksLikeWallet(value) {
  const s = String(value || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function walkExplicitPayer(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const key of ["payer", "from", "authority", "owner", "signer"]) {
    if (key === "feePayer") continue;
    const v = obj[key];
    if (typeof v === "string" && looksLikeWallet(v)) return v;
    if (v && typeof v === "object" && typeof v.address === "string" && looksLikeWallet(v.address)) {
      return v.address;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "feePayer" || k === "payTo") continue;
    if (v && typeof v === "object") {
      const found = walkExplicitPayer(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function decodePaymentHeaderJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    if (s.startsWith("{")) return JSON.parse(s);
  } catch {
    /* fall through */
  }
  if (!BASE64_RE.test(s)) return null;
  try {
    const json = Buffer.from(s, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function payerFromExactSvmTransaction(transactionBase64) {
  try {
    const bytes = getBase64Encoder().encode(String(transactionBase64 || ""));
    const tx = getTransactionDecoder().decode(bytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const instructions = getInstructionsFromCompiledTransactionMessage(compiled);
    for (const ix of instructions) {
      const programAddress = String(ix.programAddress || "");
      if (programAddress === TOKEN_PROGRAM || programAddress === TOKEN_2022_PROGRAM) {
        const accounts = ix.accounts || [];
        if (accounts.length >= 4) {
          const owner = String(accounts[3].address || "");
          if (looksLikeWallet(owner)) return owner;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Best-effort payer wallet from a verified x402 PAYMENT-SIGNATURE / X-PAYMENT header.
 * Never throws.
 */
export function extractPayerWallet(req) {
  try {
    const raw =
      (req?.get && (req.get("payment-signature") || req.get("PAYMENT-SIGNATURE") || req.get("x-payment") || req.get("X-PAYMENT"))) ||
      req?.headers?.["payment-signature"] ||
      req?.headers?.["x-payment"] ||
      "";
    const parsed = decodePaymentHeaderJson(raw);
    if (!parsed) return null;
    const explicit = walkExplicitPayer(parsed);
    if (explicit) return explicit;
    const tx = parsed.payload?.transaction || parsed.transaction;
    if (tx) return payerFromExactSvmTransaction(tx);
    return null;
  } catch {
    return null;
  }
}

export class PulseUsageStore {
  constructor(filePath = resolvePulseUsagePath()) {
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
      if (!this.db.days) this.db.days = {};
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

  _prune(now = new Date()) {
    const retain = Math.max(7, RETAIN_DAYS);
    const cutoff = utcDayKey(new Date(now.getTime() - retain * 86400_000));
    for (const k of Object.keys(this.db.days || {})) {
      // Keep anything on or after the cutoff, including future dates
      // (tests and timezone-edge records). Drop only older days.
      if (k < cutoff) delete this.db.days[k];
    }
  }

  _persist() {
    this._prune();
    this.db.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.pulse-usage.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2) + "\n", { mode: 0o640 });
    fs.renameSync(tmp, this.filePath);
  }

  _dayBucket(day) {
    if (!this.db.days[day]) this.db.days[day] = { clients: {}, payers: {} };
    if (!this.db.days[day].clients) this.db.days[day].clients = {};
    if (!this.db.days[day].payers) this.db.days[day].payers = {};
    return this.db.days[day];
  }

  /**
   * Record a successful GET /v1/pulse. Idempotent per id/wallet/day (keeps first at).
   */
  record({ day, clientId, payerWallet, kind = "paid", at = new Date().toISOString() } = {}) {
    const d = day || utcDayKey();
    const bucket = this._dayBucket(d);
    let changed = false;
    const id = String(clientId || "").trim();
    if (id) {
      if (!bucket.clients[id]) {
        bucket.clients[id] = { at, kind, payerWallet: payerWallet || null };
        changed = true;
      }
    }
    const payer = String(payerWallet || "").trim();
    if (payer) {
      if (!bucket.payers[payer]) {
        bucket.payers[payer] = { at, kind, clientId: id || null };
        changed = true;
      }
    }
    if (changed) this._persist();
    return changed;
  }

  hasClient(day, clientId) {
    const id = String(clientId || "").trim();
    if (!id) return false;
    return Boolean(this.db.days[day]?.clients?.[id]);
  }

  hasPayer(day, payerWallet) {
    const w = String(payerWallet || "").trim();
    if (!w) return false;
    return Boolean(this.db.days[day]?.payers?.[w]);
  }

  /** True if this payout wallet has a matching client-id or payer record that day. */
  matches(day, wallet) {
    const w = String(wallet || "").trim();
    if (!w || !day) return false;
    return this.hasClient(day, w) || this.hasPayer(day, w);
  }

  /**
   * Import free-pulse quota records so calls made before this log existed still count.
   * Does not overwrite richer existing rows.
   */
  ingestFreePulseFile(filePath) {
    const p = filePath || process.env.FREE_PULSE_DATA_PATH || DEFAULT_FREE_PATH;
    const resolved = path.isAbsolute(p) ? p : path.join(ROOT, p);
    if (!fs.existsSync(resolved)) return { imported: 0 };
    let src;
    try {
      src = JSON.parse(fs.readFileSync(resolved, "utf8"));
    } catch {
      return { imported: 0 };
    }
    let imported = 0;
    for (const [day, bucket] of Object.entries(src?.days || {})) {
      for (const [clientId, row] of Object.entries(bucket?.clients || {})) {
        const before = this.hasClient(day, clientId);
        this.record({
          day,
          clientId,
          kind: "free",
          at: row?.at || new Date().toISOString(),
        });
        if (!before && this.hasClient(day, clientId)) imported += 1;
      }
    }
    return { imported };
  }
}

let singleton = null;
export function getPulseUsageStore() {
  if (!singleton) {
    singleton = new PulseUsageStore();
    try {
      singleton.ingestFreePulseFile();
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "pulse_usage_backfill_failed",
          error: String(err?.message || err),
        }),
      );
    }
  }
  return singleton;
}

/** Test helper */
export function _setPulseUsageStoreForTests(store) {
  singleton = store;
}

export function pulseQualification({ wallet, roundId, usage = getPulseUsageStore() } = {}) {
  const applies = pulseRuleApplies(roundId);
  const day = pulseUsageDayForRound(roundId);
  if (!applies) return { applies: false, qualified: true, day };
  const qualified = Boolean(usage && typeof usage.matches === "function" && usage.matches(day, wallet));
  return { applies: true, qualified, day };
}

export function recordSuccessfulPulse(req, { kind, now = new Date() } = {}) {
  const store = getPulseUsageStore();
  const clientId = freePulseClientId(req) || "";
  const payerWallet = kind === "paid" ? extractPayerWallet(req) : null;
  store.record({
    day: utcDayKey(now),
    clientId: clientId || null,
    payerWallet: payerWallet || null,
    kind: kind || (payerWallet ? "paid" : "free"),
    at: now instanceof Date ? now.toISOString() : String(now),
  });
  return { clientId: clientId || null, payerWallet: payerWallet || null, day: utcDayKey(now) };
}

export function describePulseEligibilityRule() {
  return {
    firstRoundId: PULSE_RULE_FIRST_ROUND,
    firstCloseAt: `${PULSE_RULE_FIRST_ROUND}T00:00:00.000Z`,
    qualifyingDay:
      "The UTC calendar date that ends at the round's closeAt (the day before the round id). Round 2026-11-13 requires a /v1/pulse call on 2026-11-12 UTC.",
    identity:
      "X-Pulse-Client-Id must equal the bot's payout wallet (the same Solana address sent as `wallet` on POST /v1/arena/predict). There is no separate entry id.",
    freeCall:
      "A free GET /v1/pulse (headers X-Crypto-Pulse-Free: 1 and X-Pulse-Client-Id: <payout-wallet>) counts for that wallet on that UTC day.",
    paidCall:
      "A paid x402 GET /v1/pulse counts when the payer wallet matches the payout wallet, or when the request carries X-Pulse-Client-Id equal to the payout wallet.",
    ineligibleReason: NO_PULSE_REASON,
    weekly:
      "A bot must have been prize-eligible under this rule on at least one day of the week to which the rule applies. For the week of 2026-11-09 through 2026-11-15, only rounds 2026-11-13, 2026-11-14, and 2026-11-15 count toward that requirement.",
    houseBots: "official-* house bots stay ineligible even if they call /v1/pulse.",
    earlierRounds: "Rounds that closed before 00:00 UTC 2026-11-13 are unchanged and do not require a pulse call.",
  };
}
