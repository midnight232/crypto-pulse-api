/**
 * Minimal ElizaOS plugin template for Crypto Pulse Arena.
 * Uses structural types so this folder typechecks without fighting @elizaos/core
 * package export maps. In a real Eliza app, you can instead import Action/Plugin
 * from "@elizaos/core" and keep the same shape.
 *
 * Pair with @fleek-platform/eliza-plugin-mcp + mcp/stdio.js (see character JSON).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

type HandlerResult = { text: string; data?: unknown };

/** Structural subset of ElizaOS Action (v1.7+). */
export interface ArenaAction {
  name: string;
  similes: string[];
  description: string;
  validate: (...args: unknown[]) => Promise<boolean>;
  handler: (...args: unknown[]) => Promise<HandlerResult | void>;
  examples: unknown[];
}

export interface ArenaPlugin {
  name: string;
  description: string;
  actions: ArenaAction[];
}

const sharedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../shared/arena_client.mjs",
);

async function enterHandler(): Promise<HandlerResult> {
  const { enterNaive } = await import(sharedPath);
  const dryRun = String(process.env.ARENA_DRY_RUN || "").toLowerCase() === "true";
  const result = await enterNaive({ dryRun });
  return {
    text: dryRun
      ? `Dry-run Arena entry for round ${result.roundId} wallet ${result.wallet}`
      : `Submitted Arena entry for round ${result.roundId} wallet ${result.wallet}`,
    data: result,
  };
}

export const enterCryptoPulseArenaAction: ArenaAction = {
  name: "ENTER_CRYPTO_PULSE_ARENA",
  similes: [
    "ENTER_ARENA",
    "SUBMIT_CRYPTO_PULSE_PREDICTION",
    "JOIN_PREDICTION_ARENA",
  ],
  description:
    "Enter the free Crypto Pulse Prediction Arena: naive close predictions for this round's asset set (BTC/ETH/SOL), signed with ARENA_SECRET_KEY_BASE58. Set ARENA_DRY_RUN=true to avoid submitting.",
  validate: async () => true,
  handler: enterHandler,
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Enter today's Crypto Pulse Arena round" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Submitting signed predictions for this round's assets to the Arena.",
          actions: ["ENTER_CRYPTO_PULSE_ARENA"],
        },
      },
    ],
  ],
};

export const cryptoPulseArenaPlugin: ArenaPlugin = {
  name: "@midnight232/eliza-plugin-crypto-pulse-arena",
  description: "Crypto Pulse Prediction Arena entry (local signing + REST)",
  actions: [enterCryptoPulseArenaAction],
};

export default cryptoPulseArenaPlugin;
