/**
 * Non-cash Pulse Forge progression: XP, levels, accuracy streaks, badges.
 * Awarded from scored Arena rounds. Does not pay USDC or change rankings.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../../config.js";
import { buildLeaderboard } from "../scoring.js";

export const XP_COMPLETE = 25;
export const ACCURACY_STREAK_MAX_ERROR = 2;

export function xpForRound({ avgAbsPctError, rank } = {}) {
  const error = Number(avgAbsPctError);
  if (!Number.isFinite(error)) return 0;
  let xp = XP_COMPLETE;
  if (error <= 0.5) xp += 40;
  else if (error <= 1) xp += 25;
  else if (error <= 2) xp += 15;
  else if (error <= 5) xp += 5;
  if (rank === 1) xp += 30;
  else if (rank === 2) xp += 15;
  else if (rank === 3) xp += 8;
  return xp;
}

export function levelForXp(xp) {
  let level = 1;
  let need = 100;
  let remain = Math.max(0, Number(xp) || 0);
  while (remain >= need && level < 99) {
    remain -= need;
    level += 1;
    need += 50;
  }
  return { level, xpIntoLevel: remain, xpForNext: need };
}

export function addUtcDays(roundId, days) {
  const t = Date.parse(`${roundId}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function emptyDb() {
  return { version: 1, updatedAt: null, players: {} };
}

function defaultProgressPath() {
  const raw = (process.env.FORGE_PROGRESS_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return path.join(ROOT, "data", "forge-progress.json");
}

function blankPlayer(wallet, botName) {
  return {
    wallet,
    botName: botName || null,
    xp: 0,
    level: 1,
    xpIntoLevel: 0,
    xpForNext: 100,
    accuracyStreak: 0,
    bestAccuracyStreak: 0,
    roundsScored: 0,
    lastRoundId: null,
    badges: [],
    awardedRounds: {},
  };
}

function deriveBadges(player) {
  const rounds = Object.entries(player.awardedRounds).sort(([a], [b]) => a.localeCompare(b));
  const badges = [];
  const add = (id, label, roundId) => {
    if (!badges.some((b) => b.id === id)) badges.push({ id, label, earnedAtRound: roundId });
  };
  if (rounds.length) add("first-round", "First scored round", rounds[0][0]);
  let streak = 0;
  let prev = null;
  let runningXp = 0;
  for (const [id, row] of rounds) {
    runningXp += row.xp;
    const hit = row.accuracyHit === true;
    if (!hit) streak = 0;
    else if (prev && addUtcDays(prev, 1) === id && streak > 0) streak += 1;
    else streak = 1;
    if (row.avgAbsPctError <= 1) add("sharpshooter", "Sub-1% round", id);
    if (row.rank <= 3) add("podium", "Podium finish", id);
    if (streak >= 3) add("streak-3", "3-round accuracy streak", id);
    if (streak >= 7) add("streak-7", "7-round accuracy streak", id);
    if (runningXp >= 100) add("centurion", "100 XP", id);
    prev = id;
  }
  if (player.level >= 5 && rounds.length) add("level-5", "Level 5", rounds[rounds.length - 1][0]);
  return badges;
}

function recompute(player) {
  const ids = Object.keys(player.awardedRounds).sort();
  let xp = 0;
  let streak = 0;
  let best = 0;
  let prev = null;
  for (const id of ids) {
    const row = player.awardedRounds[id];
    xp += Number(row.xp) || 0;
    const hit = row.accuracyHit === true;
    if (!hit) streak = 0;
    else if (prev && addUtcDays(prev, 1) === id && streak > 0) streak += 1;
    else streak = 1;
    if (streak > best) best = streak;
    prev = id;
  }
  const lvl = levelForXp(xp);
  player.xp = xp;
  player.level = lvl.level;
  player.xpIntoLevel = lvl.xpIntoLevel;
  player.xpForNext = lvl.xpForNext;
  player.accuracyStreak = streak;
  player.bestAccuracyStreak = best;
  player.roundsScored = ids.length;
  player.lastRoundId = ids.length ? ids[ids.length - 1] : null;
  player.badges = deriveBadges(player);
  return player;
}

export function emptyProgress(wallet = null) {
  return {
    wallet,
    botName: null,
    cash: false,
    kind: "xp",
    xp: 0,
    level: 1,
    xpIntoLevel: 0,
    xpForNext: 100,
    accuracyStreak: 0,
    bestAccuracyStreak: 0,
    roundsScored: 0,
    lastRoundId: null,
    badges: [],
  };
}

export function publicProgress(player) {
  if (!player) return emptyProgress();
  return {
    wallet: player.wallet,
    botName: player.botName || null,
    cash: false,
    kind: "xp",
    xp: player.xp || 0,
    level: player.level || 1,
    xpIntoLevel: player.xpIntoLevel || 0,
    xpForNext: player.xpForNext || 100,
    accuracyStreak: player.accuracyStreak || 0,
    bestAccuracyStreak: player.bestAccuracyStreak || 0,
    roundsScored: player.roundsScored || 0,
    lastRoundId: player.lastRoundId || null,
    badges: Array.isArray(player.badges) ? player.badges : [],
  };
}

export function describeProgressionRules() {
  return {
    cash: false,
    xp: {
      completeRound: XP_COMPLETE,
      accuracyBonus: [
        { maxAvgAbsPctError: 0.5, xp: 40 },
        { maxAvgAbsPctError: 1, xp: 25 },
        { maxAvgAbsPctError: 2, xp: 15 },
        { maxAvgAbsPctError: 5, xp: 5 },
      ],
      rankBonus: { 1: 30, 2: 15, 3: 8 },
    },
    levels: "Level 1 starts at 0 XP. The next level costs 100 XP, then 150, then 200, increasing by 50.",
    accuracyStreak: `Consecutive UTC round ids with average absolute percent error at or below ${ACCURACY_STREAK_MAX_ERROR}. A miss or a skipped day resets the current streak.`,
    badges: ["first-round", "sharpshooter", "podium", "streak-3", "streak-7", "centurion", "level-5"],
    note: "XP, levels, streaks, and badges are non-cash. They do not change prize rankings, amounts, or autopay.",
  };
}

export class ForgeProgressStore {
  constructor(filePath = defaultProgressPath()) {
    this.filePath = filePath;
    this.db = emptyDb();
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      this.db = emptyDb();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.db = parsed && typeof parsed === "object" ? parsed : emptyDb();
      if (!this.db.players || typeof this.db.players !== "object") this.db.players = {};
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
    const tmp = path.join(dir, `.forge-progress.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2) + "\n", { mode: 0o640 });
    fs.renameSync(tmp, this.filePath);
  }

  get(wallet) {
    const row = this.db.players[String(wallet || "").trim()];
    return row ? structuredClone(row) : null;
  }

  list() {
    return Object.values(this.db.players).map((row) => structuredClone(row));
  }

  /** Mutates and returns the stored player. Caller persists. */
  ensure(wallet, botName) {
    const w = String(wallet || "").trim();
    if (!this.db.players[w]) this.db.players[w] = blankPlayer(w, botName);
    if (botName) this.db.players[w].botName = botName;
    return this.db.players[w];
  }
}

let singleton = null;
export function getForgeProgressStore() {
  if (!singleton) singleton = new ForgeProgressStore();
  return singleton;
}

export function _setForgeProgressStoreForTests(store) {
  singleton = store;
}

export function readProgress(wallet, store = getForgeProgressStore()) {
  return publicProgress(store.get(wallet));
}

/**
 * Award XP for one scored round. Idempotent: a wallet is awarded at most once per round.
 */
export function applyRoundProgress(arenaStore, roundId, { store = getForgeProgressStore() } = {}) {
  const round = arenaStore?.getRound?.(roundId);
  if (!round || round.status !== "scored") return { ok: false, reason: "not_scored", roundId };
  const { rows } = buildLeaderboard(round);
  let changed = false;
  for (const row of rows) {
    if (row.avgAbsPctError == null) continue;
    const player = store.ensure(row.wallet, row.botName);
    if (player.awardedRounds[roundId]) {
      if (row.botName && player.botName !== row.botName) {
        player.botName = row.botName;
        changed = true;
      }
      continue;
    }
    const xp = xpForRound(row);
    player.awardedRounds[roundId] = {
      xp,
      avgAbsPctError: row.avgAbsPctError,
      rank: row.rank,
      accuracyHit: row.avgAbsPctError <= ACCURACY_STREAK_MAX_ERROR,
    };
    recompute(player);
    changed = true;
  }
  if (changed) store._persist();
  return { ok: true, changed, roundId };
}

export function progressionDetail(wallet, store = getForgeProgressStore()) {
  const player = store.get(wallet);
  return {
    ...publicProgress(player || { wallet }),
    wallet: String(wallet || "").trim() || null,
    awardedRounds: player?.awardedRounds || {},
    rules: describeProgressionRules(),
  };
}

export function forgeXpLeaderboard({ limit = 50, store = getForgeProgressStore() } = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 50));
  const ranking = store
    .list()
    .map(publicProgress)
    .sort((a, b) => b.xp - a.xp || b.bestAccuracyStreak - a.bestAccuracyStreak || String(a.wallet).localeCompare(String(b.wallet)))
    .slice(0, cap)
    .map((row, i) => ({ rank: i + 1, ...row }));
  return {
    kind: "xp",
    cash: false,
    note: "Non-cash XP leaderboard. Daily and weekly prize rankings are unchanged.",
    ranking,
  };
}
