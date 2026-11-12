/**
 * Per-round Arena asset sets. No network, no spend.
 * Every round uses BTC, ETH, and SOL (the planned 2026-11-16 switch was cancelled).
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
  ARENA_ASSETS,
  arenaAssetsForRound,
  describeArenaAssetSchedule,
  parseRoundId,
} from "../src/arena/rounds.js";
import { PulseUsageStore, _setPulseUsageStoreForTests } from "../src/pulse-usage.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

for (const id of ["2026-11-01", "2026-11-13", "2026-11-15", "2026-11-16", "2026-11-17", "2026-12-01"]) {
  assert(arenaAssetsForRound(id).join(",") === "BTC,ETH,SOL", `${id} stays BTC,ETH,SOL`);
  assert(arenaAssetsForRound(id).includes("ETH"), `${id} includes ETH`);
  assert(!arenaAssetsForRound(id).includes("SUI"), `${id} has no SUI`);
}

const schedule = describeArenaAssetSchedule();
assert(schedule.assets.join(",") === "BTC,ETH,SOL", "schedule assets");
assert(schedule.coingeckoIds.ETH === "ethereum" && schedule.coingeckoIds.SOL === "solana", "coingecko ids");
assert(!("firstNewRoundId" in schedule), "no switch field firstNewRoundId");
assert(!/2026-11-16/.test(schedule.text) && !/SUI/.test(schedule.text) && !/HYPE/.test(schedule.text) && !/ZEC/.test(schedule.text), "schedule text does not announce a switch");
assert(/BTC/.test(schedule.text) && /ETH/.test(schedule.text) && /SOL/.test(schedule.text), "schedule text names BTC ETH SOL");

assert(normalizeAsset("BTC", "2026-11-13") === "BTC", "legacy BTC ok");
assert(normalizeAsset("ETH", "2026-11-15") === "ETH", "ETH ok on 2026-11-15");
assert(normalizeAsset("ETH", "2026-11-16") === "ETH", "ETH accepted on 2026-11-16");
assert(normalizeAsset("SOL", "2026-11-16") === "SOL", "SOL still accepted");

for (const [asset, roundId] of [["SUI", "2026-11-15"], ["HYPE", "2026-11-15"], ["ZEC", "2026-11-15"], ["SUI", "2026-11-16"], ["HYPE", "2026-11-16"], ["ZEC", "2026-11-16"]]) {
  let threw = false;
  try { normalizeAsset(asset, roundId); } catch (err) { threw = err.code === "invalid_asset"; }
  assert(threw, `${asset} rejected on ${roundId}`);
}

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

const ethOk = signPred("2026-11-16", "ETH", 2000);
assert(ethOk.asset === "ETH", "signed ETH verifies on 2026-11-16");
const solOk = signPred("2026-11-16", "SOL", 83);
assert(solOk.asset === "SOL", "signed SOL verifies");

let threw = false;
try { signPred("2026-11-16", "SUI", 0.82); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "signed SUI rejected on 2026-11-16");
threw = false;
try { signPred("2026-11-16", "ZEC", 400); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "signed ZEC rejected on 2026-11-16");
threw = false;
try { signPred("2026-11-15", "SUI", 0.82); } catch (err) { threw = err.code === "invalid_asset"; }
assert(threw, "signed SUI rejected on 2026-11-15");

// Leaderboard: closed rounds stay complete with BTC+ETH+SOL, including 2026-11-16.
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
  ARENA_ASSETS,
  { BTC: 74000, ETH: 2050, SOL: 83 },
  { BTC: 74001, ETH: 2057.95, SOL: 83.32 },
);
assert(legacyBoard.rows.length === 1, "legacy complete entry still ranks");
assert(legacyBoard.incomplete.length === 0, "legacy not marked incomplete");
assert(legacyBoard.rows[0].perAsset.ETH, "legacy perAsset includes ETH");
assert(!legacyBoard.rows[0].perAsset.SUI, "legacy perAsset has no SUI");

const laterBoard = seedRound(
  "2026-11-16",
  ARENA_ASSETS,
  { BTC: 74000, ETH: 2050, SOL: 83 },
  { BTC: 74100, ETH: 2060, SOL: 84 },
);
assert(laterBoard.rows.length === 1, "2026-11-16 complete BTC/ETH/SOL entry ranks");
assert(laterBoard.rows[0].perAsset.ETH, "2026-11-16 perAsset includes ETH");
assert(!laterBoard.rows[0].perAsset.SUI, "2026-11-16 perAsset has no SUI");

// BTC+SOL only on 2026-11-16 is incomplete because ETH is required.
const partialKp = nacl.sign.keyPair();
const partialWallet = base58.encode(partialKp.publicKey);
store.upsertPrediction("2026-11-16", { wallet: partialWallet, botName: "no-eth", asset: "BTC", price: 74000 });
store.upsertPrediction("2026-11-16", { wallet: partialWallet, botName: "no-eth", asset: "SOL", price: 83 });
const mixed = buildLeaderboard(store.getRound("2026-11-16"), { usage });
assert(mixed.rows.some((r) => r.wallet === wallet), "complete wallet still ranked");
assert(!mixed.rows.some((r) => r.wallet === partialWallet), "BTC+SOL without ETH is not ranked");
assert(mixed.incomplete.some((r) => r.wallet === partialWallet && r.missing.includes("ETH")), "missing ETH on 2026-11-16");

console.log("ok: every arena round uses BTC,ETH,SOL; 2026-11-16 accepts ETH and rejects SUI/HYPE/ZEC");
