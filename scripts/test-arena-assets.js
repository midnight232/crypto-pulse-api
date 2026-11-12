/**
 * Per-round Arena asset sets. No network, no spend.
 */
import fs from "fs";
import os from "os";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ArenaStore } from "../src/arena/store.js";
import { buildLeaderboard } from "../src/arena/scoring.js";
import { normalizeAsset, verifyPredictionSignature, buildCanonicalMessage, normalizePrice } from "../src/arena/verify.js";
import {
  ARENA_ASSETS_V2_FIRST_ROUND,
  ARENA_ASSETS_LEGACY,
  ARENA_ASSETS_V2,
  arenaAssetsForRound,
  describeArenaAssetSchedule,
  parseRoundId,
} from "../src/arena/rounds.js";
import { weekBounds } from "../src/arena/prizes.js";
import { PulseUsageStore, _setPulseUsageStoreForTests } from "../src/pulse-usage.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(ARENA_ASSETS_V2_FIRST_ROUND === "2026-11-16", `first new round ${ARENA_ASSETS_V2_FIRST_ROUND}`);
assert(weekBounds("2026-11-09").endRoundId === "2026-11-15", "weekly end is 2026-11-15");
assert(arenaAssetsForRound("2026-11-15").join(",") === "BTC,ETH,SOL", "last weekly day stays legacy");
assert(arenaAssetsForRound("2026-11-13").join(",") === "BTC,ETH,SOL", "open 2026-11-13 stays legacy");
assert(arenaAssetsForRound("2026-11-01").join(",") === "BTC,ETH,SOL", "older rounds stay legacy");
assert(arenaAssetsForRound("2026-11-16").join(",") === "BTC,SOL,SUI,HYPE", "2026-11-16 is the new set");
assert(arenaAssetsForRound("2026-11-17").join(",") === "BTC,SOL,SUI,HYPE", "later rounds use new set");
assert(!arenaAssetsForRound("2026-11-16").includes("ETH"), "ETH is not in the new set");

const schedule = describeArenaAssetSchedule();
assert(schedule.throughRoundId === "2026-11-15", "schedule through");
assert(schedule.firstNewRoundId === "2026-11-16", "schedule first");
assert(schedule.firstNewRoundCloseAt === "2026-11-16T00:00:00.000Z", "close 00:00 UTC Nov 16 = 6 PM CT Nov 15");
assert(schedule.coingeckoIds.SUI === "sui" && schedule.coingeckoIds.HYPE === "hyperliquid", "coingecko ids");

assert(normalizeAsset("BTC", "2026-11-13") === "BTC", "legacy BTC ok");
assert(normalizeAsset("ETH", "2026-11-15") === "ETH", "legacy ETH ok");
let threw = false;
try { normalizeAsset("SUI", "2026-11-15"); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "SUI rejected on legacy round");
threw = false;
try { normalizeAsset("HYPE", "2026-11-15"); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "HYPE rejected on legacy round");

assert(normalizeAsset("SUI", "2026-11-16") === "SUI", "SUI accepted on new round");
assert(normalizeAsset("HYPE", "2026-11-16") === "HYPE", "HYPE accepted on new round");
assert(normalizeAsset("SOL", "2026-11-16") === "SOL", "SOL still accepted");
threw = false;
try { normalizeAsset("ETH", "2026-11-16"); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "ETH rejected on 2026-11-16");

// Signed predict path also rejects ETH after the switch and accepts SUI.
const kp = nacl.sign.keyPair();
const wallet = base58.encode(kp.publicKey);
function signPred(roundId, asset, price) {
  const { canonical } = normalizePrice(price);
  const message = buildCanonicalMessage({
    roundId, wallet, asset, priceCanonical: canonical, botName: "asset-test",
  });
  const signature = base58.encode(nacl.sign.detached(Buffer.from(message), kp.secretKey));
  return verifyPredictionSignature({
    roundId, wallet, asset, price, botName: "asset-test", signature,
  });
}
const suiOk = signPred("2026-11-16", "SUI", 0.82);
assert(suiOk.asset === "SUI", "signed SUI verifies");
threw = false;
try { signPred("2026-11-16", "ETH", 2000); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "signed ETH rejected on 2026-11-16");
threw = false;
try { signPred("2026-11-15", "SUI", 0.82); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "signed SUI rejected on 2026-11-15");

// Leaderboard: a closed legacy round stays complete with BTC+ETH+SOL only.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-assets-"));
const usage = new PulseUsageStore(path.join(tmp, "pulse-usage.json"));
_setPulseUsageStoreForTests(usage);
const store = new ArenaStore(path.join(tmp, "arena.json"));

function seedRound(roundId, assets, prices, closes) {
  const meta = parseRoundId(roundId);
  store.ensureRound(meta);
  for (const asset of assets) {
    store.upsertPrediction(roundId, {
      wallet,
      botName: "asset-test",
      asset,
      price: prices[asset],
    });
  }
  const errors = {};
  for (const asset of assets) {
    const actual = closes[asset];
    errors[`${wallet}|${asset}`] = (Math.abs(prices[asset] - actual) / actual) * 100;
  }
  store.applyErrors(roundId, errors);
  store.setRoundCloses(roundId, { ...closes, fetchedAt: new Date().toISOString(), source: "test" }, "scored");
  return buildLeaderboard(store.getRound(roundId), { usage });
}

const legacyBoard = seedRound(
  "2026-11-12",
  ARENA_ASSETS_LEGACY,
  { BTC: 74000, ETH: 2050, SOL: 83 },
  { BTC: 74001, ETH: 2057.95, SOL: 83.32 },
);
assert(legacyBoard.rows.length === 1, "legacy complete entry still ranks");
assert(legacyBoard.incomplete.length === 0, "legacy not marked incomplete");
assert(legacyBoard.rows[0].perAsset.ETH, "legacy perAsset includes ETH");
assert(!legacyBoard.rows[0].perAsset.SUI, "legacy perAsset has no SUI");

const newBoard = seedRound(
  "2026-11-16",
  ARENA_ASSETS_V2,
  { BTC: 74000, SOL: 83, SUI: 0.82, HYPE: 72 },
  { BTC: 74100, SOL: 84, SUI: 0.83, HYPE: 71 },
);
assert(newBoard.rows.length === 1, "new-set complete entry ranks");
assert(newBoard.rows[0].perAsset.SUI && newBoard.rows[0].perAsset.HYPE, "new perAsset has SUI and HYPE");
assert(!newBoard.rows[0].perAsset.ETH, "new perAsset has no ETH");

// ETH-only on a new-set round is incomplete, not a ranked entry.
const ethOnly = nacl.sign.keyPair();
const ethWallet = base58.encode(ethOnly.publicKey);
store.upsertPrediction("2026-11-16", {
  wallet: ethWallet, botName: "eth-only", asset: "ETH", price: 2000,
});
const mixed = buildLeaderboard(store.getRound("2026-11-16"), { usage });
assert(mixed.rows.some((r) => r.wallet === wallet), "complete new-set wallet still ranked");
assert(!mixed.rows.some((r) => r.wallet === ethWallet), "ETH-only is not ranked after the switch");
assert(mixed.incomplete.some((r) => r.wallet === ethWallet && r.missing.includes("SUI")), "ETH-only missing new assets");

console.log("ok: arena asset schedule, legacy history complete, 2026-11-16 accepts SUI/HYPE and rejects ETH");
