/**
 * One free live GET /v1/pulse per client per UTC day.
 *
 * Opt-in only: clients must send header X-Crypto-Pulse-Free: 1 and a stable
 * X-Pulse-Client-Id (wallet pubkey or opaque id, 8-128 chars). Bare GET without
 * these headers still hits x402 paymentMiddleware → HTTP 402 (Bazaar-safe).
 *
 * Identity is client-id + soft IP cap (max free client ids per IP per day).
 */
import fs from "fs";
import path from "path";
import { ROOT } from "./config.js";

const DEFAULT_PATH = path.join(ROOT, "data", "free-pulse.json");
const CLIENT_RE = /^[A-Za-z0-9:_\-.]{8,128}$/;
const MAX_CLIENTS_PER_IP_PER_DAY = Number(process.env.FREE_PULSE_MAX_CLIENTS_PER_IP || 20);

function resolvePath() {
  const raw = (process.env.FREE_PULSE_DATA_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return DEFAULT_PATH;
}

function utcDayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}

function emptyDb() {
  return { version: 1, days: {} };
}

export class FreePulseStore {
  constructor(filePath = resolvePath()) {
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
      this.db = JSON.parse(fs.readFileSync(this.filePath, "utf8")) || emptyDb();
      if (!this.db.days) this.db.days = {};
    } catch {
      this.db = emptyDb();
      this._persist();
    }
  }

  _persist() {
    // Drop days older than 3 UTC days to keep file small
    const keep = new Set();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      keep.add(utcDayKey(new Date(now - i * 86400_000)));
    }
    for (const k of Object.keys(this.db.days || {})) {
      if (!keep.has(k)) delete this.db.days[k];
    }
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.free-pulse.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db) + "\n", { mode: 0o640 });
    fs.renameSync(tmp, this.filePath);
  }

  _dayBucket(day) {
    if (!this.db.days[day]) this.db.days[day] = { clients: {}, ips: {} };
    if (!this.db.days[day].clients) this.db.days[day].clients = {};
    if (!this.db.days[day].ips) this.db.days[day].ips = {};
    return this.db.days[day];
  }

  /**
   * @returns {{ ok: true, day, clientId, remaining: 0 } | { ok: false, reason, status?, day?, clientId? }}
   */
  tryConsume({ clientId, ip, now = new Date() } = {}) {
    const id = String(clientId || "").trim();
    if (!CLIENT_RE.test(id)) {
      return { ok: false, reason: "invalid_client_id", status: 400 };
    }
    const day = utcDayKey(now);
    const bucket = this._dayBucket(day);
    if (bucket.clients[id]) {
      return {
        ok: false,
        reason: "free_quota_exhausted",
        status: 402,
        day,
        clientId: id,
        usedAt: bucket.clients[id].at,
      };
    }
    const ipKey = String(ip || "unknown").slice(0, 64);
    const ipCount = bucket.ips[ipKey] || 0;
    if (ipCount >= MAX_CLIENTS_PER_IP_PER_DAY) {
      return { ok: false, reason: "ip_client_cap", status: 429, day, clientId: id };
    }
    const at = now.toISOString();
    bucket.clients[id] = { at, ip: ipKey };
    bucket.ips[ipKey] = ipCount + 1;
    this._persist();
    return { ok: true, day, clientId: id, remaining: 0, usedAt: at };
  }

  status({ clientId, now = new Date() } = {}) {
    const id = String(clientId || "").trim();
    const day = utcDayKey(now);
    const bucket = this.db.days[day];
    const used = Boolean(id && bucket?.clients?.[id]);
    return {
      day,
      clientId: id || null,
      freeDailyLimit: 1,
      used,
      remaining: used ? 0 : id ? 1 : null,
      howToClaim:
        "Send headers X-Crypto-Pulse-Free: 1 and X-Pulse-Client-Id: <stable-id-8-128> on GET /v1/pulse. Bare GET without payment still returns HTTP 402 (x402).",
    };
  }
}

let singleton = null;
export function getFreePulseStore() {
  if (!singleton) singleton = new FreePulseStore();
  return singleton;
}

export function wantsFreePulse(req) {
  const h = String(req.get("x-crypto-pulse-free") || req.get("x-free-pulse") || "").toLowerCase();
  if (h === "1" || h === "true" || h === "yes") return true;
  const q = String(req.query?.free || "").toLowerCase();
  return q === "1" || q === "true" || q === "yes";
}

export function freePulseClientId(req) {
  return (
    String(req.get("x-pulse-client-id") || req.get("x-client-id") || "").trim() ||
    String(req.query?.clientId || "").trim()
  );
}

export function describeFreePulseRule() {
  return {
    endpoint: "GET /v1/pulse",
    freePerUtcDay: 1,
    identity: "X-Pulse-Client-Id (stable wallet address or opaque id, 8-128 chars [A-Za-z0-9:_.-])",
    optInHeader: "X-Crypto-Pulse-Free: 1",
    bazaarSafe:
      "Requests without the free opt-in headers always receive HTTP 402 PAYMENT-REQUIRED so x402 discovery/indexing is unchanged.",
    afterQuota: "Further calls in the same UTC day require normal x402 payment.",
    alsoFree: ["GET /v1/sample (stale ≤15 min)", "Arena endpoints", "MCP free tools"],
    maxDistinctClientIdsPerIpPerDay: MAX_CLIENTS_PER_IP_PER_DAY,
  };
}
