/**
 * Official house bots for the Prediction Arena.
 * Always labeled house:true / prizeEligible:false. Never win prizes or receive autopay.
 * Secrets live only on the server (ARENA_HOUSE_WALLETS_PATH); never logged.
 */
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ROOT } from "../config.js";
import { ARENA_ASSETS } from "./rounds.js";
import { buildCanonicalMessage, normalizePrice } from "./verify.js";
import { currentEntryRound } from "./rounds.js";

export const HOUSE_BOT_PREFIX = "official-";

/** Catalog of house strategies (public metadata; no keys). */
export const HOUSE_BOT_DEFS = Object.freeze([
  {
    id: "baseline",
    botName: "official-baseline",
    label: "House baseline",
    strategy:
      "Predicts the current CoinGecko USD spot for each asset (naive hold-to-close).",
  },
  {
    id: "momentum",
    botName: "official-momentum",
    label: "House momentum",
    strategy:
      "Extrapolates the last 24h % change once from the current spot (spot * (1 + change24h/100)).",
  },
  {
    id: "meanrevert",
    botName: "official-meanrevert",
    label: "House mean-revert",
    strategy:
      "Fades half of the last 24h % change from the current spot (spot * (1 - 0.5 * change24h/100)).",
  },
]);

const HOUSE_NAME_SET = new Set(HOUSE_BOT_DEFS.map((b) => b.botName.toLowerCase()));

export function isHouseBotName(botName) {
  const n = String(botName || "").trim().toLowerCase();
  if (!n) return false;
  if (HOUSE_NAME_SET.has(n)) return true;
  return n.startsWith(HOUSE_BOT_PREFIX);
}

export function isReservedHouseName(botName) {
  return isHouseBotName(botName);
}

export function houseBotsEnabled() {
  const raw = (process.env.ARENA_HOUSE_BOTS || "on").toLowerCase().trim();
  return raw === "on" || raw === "1" || raw === "true" || raw === "yes";
}

export function resolveHouseWalletsPath() {
  const raw = (process.env.ARENA_HOUSE_WALLETS_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return "/etc/arena-house-wallets.json";
}

let cachedWallets = null;
let cachedWalletsMtime = null;

function readHouseWalletFile() {
  const filePath = resolveHouseWalletsPath();
  if (!fs.existsSync(filePath)) return null;
  const st = fs.statSync(filePath);
  if (cachedWallets && cachedWalletsMtime === st.mtimeMs) return cachedWallets;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  cachedWallets = parsed;
  cachedWalletsMtime = st.mtimeMs;
  return parsed;
}

/** Public wallet addresses for house bots (no secrets). */
export function listHouseWalletsPublic() {
  const file = readHouseWalletFile();
  const out = [];
  for (const def of HOUSE_BOT_DEFS) {
    const row = (file?.bots || []).find((b) => b.id === def.id || b.botName === def.botName);
    out.push({
      ...def,
      wallet: row?.wallet || null,
      house: true,
      prizeEligible: false,
    });
  }
  return out;
}

export function isHouseWallet(wallet) {
  const w = String(wallet || "").trim();
  if (!w) return false;
  const file = readHouseWalletFile();
  return (file?.bots || []).some((b) => b.wallet === w);
}

export function isHouseEntrant({ wallet, botName } = {}) {
  return isHouseWallet(wallet) || isHouseBotName(botName);
}

function loadKeypairForBot(botRow) {
  const secretRaw = String(botRow.secretKeyBase58 || "").trim();
  if (!secretRaw) throw new Error("house_wallet_missing_secret");
  const secret = base58.decode(secretRaw);
  if (secret.length === 64) return nacl.sign.keyPair.fromSecretKey(secret);
  if (secret.length === 32) return nacl.sign.keyPair.fromSeed(secret);
  throw new Error("house_wallet_bad_secret_length");
}

/**
 * Generate house wallets file if missing. Returns public summary only.
 * Caller must ensure directory permissions; never logs secrets.
 */
export function ensureHouseWalletsFile({ force = false } = {}) {
  const filePath = resolveHouseWalletsPath();
  if (!force && fs.existsSync(filePath)) {
    const existing = readHouseWalletFile();
    return {
      path: filePath,
      created: false,
      bots: listHouseWalletsPublic(),
      count: (existing?.bots || []).length,
    };
  }
  const bots = HOUSE_BOT_DEFS.map((def) => {
    const kp = nacl.sign.keyPair();
    return {
      id: def.id,
      botName: def.botName,
      wallet: base58.encode(kp.publicKey),
      secretKeyBase58: base58.encode(kp.secretKey),
    };
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, bots }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
  cachedWallets = null;
  cachedWalletsMtime = null;
  return { path: filePath, created: true, bots: listHouseWalletsPublic(), count: bots.length };
}

async function fetchSpotsWithChange() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      BTC: { usd: Number(data.bitcoin?.usd), change24hPct: Number(data.bitcoin?.usd_24h_change) },
      ETH: { usd: Number(data.ethereum?.usd), change24hPct: Number(data.ethereum?.usd_24h_change) },
      SOL: { usd: Number(data.solana?.usd), change24hPct: Number(data.solana?.usd_24h_change) },
      source: url,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

export function predictForStrategy(strategyId, asset, spots) {
  const row = spots[asset];
  if (!row || !Number.isFinite(row.usd) || row.usd <= 0) {
    throw new Error(`missing_spot_${asset}`);
  }
  const ch = Number.isFinite(row.change24hPct) ? row.change24hPct : 0;
  let price;
  if (strategyId === "momentum") {
    price = row.usd * (1 + ch / 100);
  } else if (strategyId === "meanrevert") {
    price = row.usd * (1 - 0.5 * (ch / 100));
  } else {
    // baseline
    price = row.usd;
  }
  if (!Number.isFinite(price) || price <= 0) price = row.usd;
  return normalizePrice(price).value;
}

/**
 * Enter the current open round for all configured house bots.
 * Uses submitPrediction from index (injected to avoid circular init issues).
 */
export async function runHouseBotEntries({
  submitPrediction,
  getStore,
  fetchSpots = fetchSpotsWithChange,
  now = new Date(),
} = {}) {
  if (!houseBotsEnabled()) {
    return { ok: true, skipped: true, reason: "house_bots_disabled" };
  }
  if (typeof submitPrediction !== "function") {
    throw new Error("submitPrediction required");
  }
  const file = readHouseWalletFile();
  if (!file?.bots?.length) {
    return { ok: false, reason: "house_wallets_missing" };
  }

  const meta = currentEntryRound(now);
  if (meta.lifecycle !== "open") {
    return { ok: true, skipped: true, reason: "round_not_open", roundId: meta.roundId, lifecycle: meta.lifecycle };
  }

  let spots;
  try {
    spots = await fetchSpots();
  } catch (err) {
    return { ok: false, reason: "spots_fetch_failed", error: String(err?.message || err) };
  }

  const results = [];
  for (const def of HOUSE_BOT_DEFS) {
    const botRow = file.bots.find((b) => b.id === def.id || b.botName === def.botName);
    if (!botRow) {
      results.push({ botName: def.botName, ok: false, reason: "wallet_not_configured" });
      continue;
    }
    let kp;
    try {
      kp = loadKeypairForBot(botRow);
    } catch (err) {
      results.push({ botName: def.botName, ok: false, reason: String(err?.message || err) });
      continue;
    }
    const wallet = base58.encode(kp.publicKey);
    if (botRow.wallet && botRow.wallet !== wallet) {
      results.push({ botName: def.botName, ok: false, reason: "wallet_mismatch" });
      continue;
    }

    // Skip if already complete for this round
    if (getStore) {
      const round = getStore().getRound(meta.roundId);
      if (round) {
        const have = new Set(
          round.predictions.filter((p) => p.wallet === wallet).map((p) => p.asset),
        );
        if (ARENA_ASSETS.every((a) => have.has(a))) {
          results.push({ botName: def.botName, wallet, ok: true, already: true, roundId: meta.roundId });
          continue;
        }
      }
    }

    const assetResults = [];
    for (const asset of ARENA_ASSETS) {
      try {
        const price = predictForStrategy(def.id, asset, spots);
        const { canonical } = normalizePrice(price);
        const message = buildCanonicalMessage({
          roundId: meta.roundId,
          wallet,
          asset,
          priceCanonical: canonical,
          botName: def.botName,
        });
        const signature = base58.encode(
          nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
        );
        const submitted = submitPrediction({
          roundId: meta.roundId,
          wallet,
          asset,
          price,
          botName: def.botName,
          signature,
        });
        assetResults.push({ asset, ok: true, price, created: submitted.created });
      } catch (err) {
        assetResults.push({
          asset,
          ok: false,
          error: err.code || String(err?.message || err),
        });
      }
    }
    results.push({
      botName: def.botName,
      wallet,
      roundId: meta.roundId,
      house: true,
      prizeEligible: false,
      assets: assetResults,
      ok: assetResults.every((a) => a.ok),
    });
  }

  console.log(
    JSON.stringify({
      event: "arena_house_bots_tick",
      roundId: meta.roundId,
      ok: results.every((r) => r.ok || r.already),
      bots: results.map((r) => ({
        botName: r.botName,
        wallet: r.wallet ? `${r.wallet.slice(0, 4)}…` : null,
        ok: r.ok || r.already,
        already: Boolean(r.already),
      })),
    }),
  );

  return { ok: true, roundId: meta.roundId, results, spotsAt: spots.fetchedAt };
}

let houseTimer = null;

export function startHouseBotScheduler({
  submitPrediction,
  getStore,
  intervalMs = 15 * 60_000,
} = {}) {
  if (houseTimer) return;
  if (!houseBotsEnabled()) {
    console.log(JSON.stringify({ event: "arena_house_bots_disabled" }));
    return;
  }
  const tick = () => {
    runHouseBotEntries({ submitPrediction, getStore }).catch((err) => {
      console.error(
        JSON.stringify({ event: "arena_house_bots_error", error: String(err?.message || err) }),
      );
    });
  };
  // Delay first tick slightly so the HTTP server is up
  setTimeout(tick, 5_000).unref?.();
  houseTimer = setInterval(tick, intervalMs);
  if (typeof houseTimer.unref === "function") houseTimer.unref();
  console.log(JSON.stringify({ event: "arena_house_bots_started", intervalMs }));
}

export function stopHouseBotScheduler() {
  if (houseTimer) {
    clearInterval(houseTimer);
    houseTimer = null;
  }
}
