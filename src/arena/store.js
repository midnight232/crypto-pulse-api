/**
 * Persistent JSON store for arena rounds + predictions.
 * Atomic write (temp + rename). No secrets. No wallet private keys.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../config.js";

const DEFAULT_PATH = path.join(ROOT, "data", "arena.json");

function emptyDb() {
  return {
    version: 1,
    updatedAt: null,
    rounds: {},
    // Manual payout tracking only (server never sends funds).
    payouts: { daily: {}, weekly: {} },
  };
}

export function resolveArenaDataPath() {
  const raw = (process.env.ARENA_DATA_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return DEFAULT_PATH;
}

export class ArenaStore {
  constructor(filePath = resolveArenaDataPath()) {
    this.filePath = filePath;
    this.db = emptyDb();
    this._ensureLoaded();
  }

  _ensureLoaded() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this._persist();
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.rounds) {
        throw new Error("invalid arena db shape");
      }
      this.db = parsed;
      if (!this.db.payouts) this.db.payouts = { daily: {}, weekly: {} };
    } catch (err) {
      // Keep going with empty db but do not clobber a corrupt file silently —
      // rename aside once and start fresh.
      const bak = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        fs.renameSync(this.filePath, bak);
      } catch {
        /* ignore */
      }
      console.error(
        JSON.stringify({
          event: "arena_store_reset",
          reason: String(err?.message || err),
          backup: bak,
        }),
      );
      this.db = emptyDb();
      this._persist();
    }
  }

  _persist() {
    this.db.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.arena.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2) + "\n", {
      mode: 0o640,
    });
    fs.renameSync(tmp, this.filePath);
  }

  getRound(roundId) {
    return this.db.rounds[roundId] || null;
  }

  ensureRound(meta) {
    const existing = this.db.rounds[meta.roundId];
    if (existing) {
      // Keep timing fields in sync with the clock helper (config changes).
      existing.openAt = meta.openAt;
      existing.cutoffAt = meta.cutoffAt;
      existing.closeAt = meta.closeAt;
      return existing;
    }
    const round = {
      roundId: meta.roundId,
      openAt: meta.openAt,
      cutoffAt: meta.cutoffAt,
      closeAt: meta.closeAt,
      status: "open", // open | locked | scored
      closes: null, // { BTC, ETH, SOL, fetchedAt, source } after score
      scoredAt: null,
      predictions: [], // { wallet, botName, asset, price, message, signature, submittedAt, updatedAt, absPctError }
    };
    this.db.rounds[meta.roundId] = round;
    this._persist();
    return round;
  }

  listRoundIds() {
    return Object.keys(this.db.rounds).sort();
  }

  /**
   * Upsert one asset prediction for a wallet in a round.
   * Returns { created: boolean, prediction }
   */
  upsertPrediction(roundId, prediction) {
    const round = this.db.rounds[roundId];
    if (!round) throw new Error("round_missing");
    const idx = round.predictions.findIndex(
      (p) => p.wallet === prediction.wallet && p.asset === prediction.asset,
    );
    const now = new Date().toISOString();
    if (idx >= 0) {
      const prev = round.predictions[idx];
      round.predictions[idx] = {
        ...prev,
        ...prediction,
        submittedAt: prev.submittedAt,
        updatedAt: now,
      };
      this._persist();
      return { created: false, prediction: round.predictions[idx] };
    }
    const row = {
      ...prediction,
      submittedAt: now,
      updatedAt: now,
      absPctError: null,
    };
    round.predictions.push(row);
    this._persist();
    return { created: true, prediction: row };
  }

  deletePrediction(roundId, wallet, asset) {
    const round = this.db.rounds[roundId];
    if (!round) return false;
    const before = round.predictions.length;
    round.predictions = round.predictions.filter(
      (p) => !(p.wallet === wallet && (!asset || p.asset === asset)),
    );
    if (round.predictions.length === before) return false;
    this._persist();
    return true;
  }

  setRoundCloses(roundId, closes, status = "scored") {
    const round = this.db.rounds[roundId];
    if (!round) throw new Error("round_missing");
    round.closes = closes;
    round.status = status;
    round.scoredAt = new Date().toISOString();
    this._persist();
    return round;
  }

  setRoundStatus(roundId, status) {
    const round = this.db.rounds[roundId];
    if (!round) return null;
    round.status = status;
    this._persist();
    return round;
  }

  /** Attach per-prediction absPctError after scoring. */
  applyErrors(roundId, errorMap) {
    const round = this.db.rounds[roundId];
    if (!round) return;
    for (const p of round.predictions) {
      const key = `${p.wallet}|${p.asset}`;
      if (Object.prototype.hasOwnProperty.call(errorMap, key)) {
        p.absPctError = errorMap[key];
      }
    }
    this._persist();
  }

  _ensurePayouts() {
    if (!this.db.payouts) this.db.payouts = { daily: {}, weekly: {} };
    if (!this.db.payouts.daily) this.db.payouts.daily = {};
    if (!this.db.payouts.weekly) this.db.payouts.weekly = {};
  }

  getPayout(type, id) {
    this._ensurePayouts();
    const bucket = type === "weekly" ? this.db.payouts.weekly : this.db.payouts.daily;
    return bucket[id] || { paid: false, paidAt: null, note: null };
  }

  setPayout(type, id, { paid, note } = {}) {
    this._ensurePayouts();
    if (type !== "daily" && type !== "weekly") {
      throw Object.assign(new Error("type must be daily or weekly"), { code: "invalid_type" });
    }
    const bucket = type === "weekly" ? this.db.payouts.weekly : this.db.payouts.daily;
    const prev = bucket[id] || { paid: false, paidAt: null, note: null };
    const nextPaid = Boolean(paid);
    bucket[id] = {
      paid: nextPaid,
      paidAt: nextPaid ? new Date().toISOString() : null,
      note: note != null ? String(note).slice(0, 200) : prev.note,
    };
    this._persist();
    return bucket[id];
  }

  listPayouts() {
    this._ensurePayouts();
    return {
      daily: { ...this.db.payouts.daily },
      weekly: { ...this.db.payouts.weekly },
    };
  }
}
