/**
 * Pulse Forge bot configs. One config per payout wallet.
 * Configuring a bot does not enter the Arena. Entering forwards signed
 * quotes through the existing submitPrediction path.
 */
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { ROOT } from "../../config.js";
import { currentEntryRound, arenaAssetsForRound } from "../rounds.js";
import { buildCanonicalMessage, normalizeWallet, sanitizeBotName } from "../verify.js";
import { isReservedHouseName } from "../house.js";
import {
  buildForgeConfigMessage,
  blendModuleQuotes,
  getTemplate,
  normalizeForgeAssets,
  normalizeModules,
  normalizeSnapshot,
  quoteModule,
  priceCanonical,
} from "./signals.js";

function fail(message, code, status = 400, extra = {}) {
  throw Object.assign(new Error(message), { code, status, ...extra });
}

function defaultBotsPath() {
  const raw = (process.env.FORGE_BOTS_PATH || "").trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
  return path.join(ROOT, "data", "forge-bots.json");
}

function emptyDb() {
  return { version: 1, updatedAt: null, bots: {} };
}

export class ForgeBotStore {
  constructor(filePath = defaultBotsPath()) {
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
      if (!this.db.bots || typeof this.db.bots !== "object") this.db.bots = {};
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
    const tmp = path.join(dir, `.forge-bots.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2) + "\n", { mode: 0o640 });
    fs.renameSync(tmp, this.filePath);
  }

  get(wallet) {
    const row = this.db.bots[String(wallet || "").trim()];
    return row ? structuredClone(row) : null;
  }

  save(config) {
    const prev = this.db.bots[config.wallet];
    const now = new Date().toISOString();
    const row = {
      wallet: config.wallet,
      botName: config.botName,
      templateId: config.templateId,
      modules: config.modules,
      assets: config.assets,
      assetPreset: config.assetPreset || null,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };
    this.db.bots[config.wallet] = row;
    this._persist();
    return structuredClone(row);
  }
}

let singleton = null;
export function getForgeBotStore() {
  if (!singleton) singleton = new ForgeBotStore();
  return singleton;
}

export function _setForgeBotStoreForTests(store) {
  singleton = store;
}

export function resolveForgeConfig({
  wallet,
  botName,
  templateId,
  modules,
  assets,
  assetPreset,
} = {}) {
  const name = sanitizeBotName(botName);
  if (!name) fail("botName is required", "invalid_bot_name");
  if (isReservedHouseName(name)) {
    fail("botName prefix official- is reserved for Crypto Pulse house bots", "reserved_bot_name", 403);
  }
  let resolvedModules;
  let resolvedTemplate = String(templateId || "").trim();
  if (Array.isArray(modules) && modules.length) {
    resolvedModules = normalizeModules(modules);
    if (!resolvedTemplate) resolvedTemplate = "custom";
    const template = getTemplate(resolvedTemplate);
    if (template) {
      const same =
        template.modules.length === resolvedModules.length &&
        normalizeModules(template.modules).every((m, i) => m.id === resolvedModules[i].id && m.weight === resolvedModules[i].weight);
      if (!same) resolvedTemplate = "custom";
    }
  } else if (resolvedTemplate) {
    const template = getTemplate(resolvedTemplate);
    if (!template) fail(`unknown template: ${resolvedTemplate}`, "unknown_template");
    resolvedModules = normalizeModules(template.modules);
  } else {
    fail("templateId or modules is required", "missing_config");
  }
  const assetPick = normalizeForgeAssets({ assets, assetPreset });
  let walletOut = String(wallet || "").trim();
  if (walletOut) {
    try {
      walletOut = normalizeWallet(walletOut).wallet;
    } catch (err) {
      throw Object.assign(new Error(err.message), { code: err.code || "invalid_wallet", status: 400 });
    }
  }
  return {
    wallet: walletOut,
    botName: name,
    templateId: resolvedTemplate,
    modules: resolvedModules,
    assets: assetPick.assets,
    assetPreset: assetPick.assetPreset,
  };
}

function verifyConfigSignature(config, signature) {
  const signMessage = buildForgeConfigMessage(config);
  if (!config.wallet) fail("wallet is required", "missing_wallet");
  if (!signature) {
    fail("signature is required", "missing_signature", 400, { signMessage });
  }
  let sig;
  try {
    sig = base58.decode(String(signature).trim());
  } catch {
    fail("signature must be base58", "invalid_signature", 400, { signMessage });
  }
  if (sig.length !== 64) fail("signature must be 64 bytes", "invalid_signature", 400, { signMessage });
  const { bytes } = normalizeWallet(config.wallet);
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(signMessage), sig, bytes);
  if (!ok) {
    fail("signature does not match this wallet and forge config", "invalid_signature", 400, { signMessage });
  }
  return signMessage;
}

export function forgeConfigMessage(input) {
  const config = resolveForgeConfig(input);
  if (!config.wallet) fail("wallet is required", "missing_wallet");
  return { message: buildForgeConfigMessage(config), config };
}

export function configureForgeBot(input, store = getForgeBotStore()) {
  const config = resolveForgeConfig(input);
  const message = verifyConfigSignature(config, input?.signature);
  const saved = store.save(config);
  return { ok: true, created: saved.createdAt === saved.updatedAt, message, bot: saved };
}

export function getForgeBot(wallet, store = getForgeBotStore()) {
  const w = String(wallet || "").trim();
  if (!w) fail("wallet is required", "missing_wallet");
  const bot = store.get(w);
  if (!bot) fail("no Pulse Forge bot configured for this wallet", "forge_bot_missing", 404);
  return bot;
}

export function quoteForgeConfig(config, snapshot, roundId) {
  const ctx = normalizeSnapshot(snapshot);
  const round = String(roundId || "").trim() || currentEntryRound().roundId;
  const required = arenaAssetsForRound(round);
  const quotes = [];
  for (const asset of config.assets) {
    const parts = [];
    for (const mod of config.modules) {
      const q = quoteModule(mod.id, asset, ctx);
      const priced = priceCanonical(q.price);
      parts.push({
        id: mod.id,
        weight: mod.weight,
        price: priced.value,
        fallback: q.fallback,
      });
    }
    const blended = priceCanonical(blendModuleQuotes(parts));
    let message = null;
    if (config.wallet && config.botName) {
      message = buildCanonicalMessage({
        roundId: round,
        wallet: config.wallet,
        asset,
        priceCanonical: blended.canonical,
        botName: config.botName,
      });
    }
    quotes.push({
      asset,
      price: blended.value,
      priceCanonical: blended.canonical,
      message,
      modules: parts,
    });
  }
  const rankingComplete = required.every((a) => config.assets.includes(a));
  return {
    roundId: round,
    wallet: config.wallet || null,
    botName: config.botName || null,
    templateId: config.templateId,
    modules: config.modules,
    assets: config.assets,
    rankingComplete,
    rankingNote: rankingComplete
      ? "Quotes cover every asset in this round's set, so a signed entry can be ranked."
      : `Quotes cover ${config.assets.join(", ")} only. Ranking still requires ${required.join(", ")}.`,
    quotes,
  };
}

export function previewForgeBot({
  wallet,
  botName,
  templateId,
  modules,
  assets,
  assetPreset,
  snapshot,
  roundId,
  store = getForgeBotStore(),
} = {}) {
  const inline = (Array.isArray(modules) && modules.length) || templateId || assetPreset || (Array.isArray(assets) && assets.length);
  let config;
  if (inline) {
    config = resolveForgeConfig({
      wallet,
      botName: botName || "preview",
      templateId,
      modules,
      assets,
      assetPreset,
    });
    if (!wallet) config.wallet = "";
  } else if (wallet) {
    config = getForgeBot(wallet, store);
  } else {
    fail("pass a wallet with a saved bot, or templateId / modules to preview", "missing_config");
  }
  return quoteForgeConfig(config, snapshot, roundId);
}

/**
 * Submit signed quotes for a saved bot. `submitPrediction` is the existing
 * Arena entry function (injected so this module does not import the arena index).
 */
export function enterForgeBot({
  wallet,
  roundId,
  snapshot,
  signatures,
  ref,
  submitPrediction,
  store = getForgeBotStore(),
} = {}) {
  if (typeof submitPrediction !== "function") {
    fail("submitPrediction required", "internal", 500);
  }
  const bot = getForgeBot(wallet, store);
  const quoted = quoteForgeConfig(bot, snapshot, roundId);
  const sigs = signatures && typeof signatures === "object" ? signatures : {};
  const entries = [];
  for (const quote of quoted.quotes) {
    const signature = sigs[quote.asset];
    if (!signature) {
      fail(`signature required for ${quote.asset}`, "missing_signature", 400, {
        asset: quote.asset,
        signMessage: quote.message,
        price: quote.price,
      });
    }
    const result = submitPrediction({
      roundId: quoted.roundId,
      wallet: bot.wallet,
      asset: quote.asset,
      price: quote.price,
      botName: bot.botName,
      signature,
      ref,
    });
    entries.push({
      asset: quote.asset,
      price: quote.price,
      created: result.created,
      updated: result.updated,
      prizeEligible: result.prediction?.prizeEligible,
      eligible: result.prediction?.eligible,
      ineligibleReason: result.prediction?.ineligibleReason,
      house: result.prediction?.house,
    });
  }
  return {
    ok: true,
    roundId: quoted.roundId,
    wallet: bot.wallet,
    botName: bot.botName,
    templateId: bot.templateId,
    rankingComplete: quoted.rankingComplete,
    entries,
    note: "Entered through the existing Arena predict path. Prize eligibility is unchanged.",
  };
}
