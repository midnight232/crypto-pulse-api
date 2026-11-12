/**
 * Solana Agent Kit v2 Action: enter Crypto Pulse Prediction Arena.
 */
import { z } from "zod";
import type { Action, SolanaAgentKit } from "solana-agent-kit";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sharedUrl = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../shared/arena_client.mjs"),
).href;

export const enterCryptoPulseArenaAction: Action = {
  name: "ENTER_CRYPTO_PULSE_ARENA",
  similes: [
    "enter prediction arena",
    "submit crypto pulse predictions",
    "join crypto pulse arena",
  ],
  description:
    "Enter the free Crypto Pulse Prediction Arena with naive close predictions for this round's asset set (BTC/ETH/SOL through 2026-11-15; BTC/SOL/SUI/HYPE from 2026-11-16). Signs with ARENA_SECRET_KEY_BASE58 (or a throwaway key). Pass dryRun=true to avoid submitting. Prizes pay automatically on-chain from the public prize wallet while funded.",
  examples: [
    [
      {
        input: { dryRun: true },
        output: { dryRun: true, roundId: "2026-11-04", ok: true },
        explanation: "Build and sign predictions without posting.",
      },
    ],
  ],
  schema: z.object({
    dryRun: z.boolean().optional().describe("If true, do not POST to /v1/arena/predict"),
  }),
  handler: async (_agent: SolanaAgentKit, input: Record<string, unknown>) => {
    const { enterNaive, fetchPrizeWallet, fetchRules } = await import(sharedUrl);
    const dryRun = Boolean(input.dryRun ?? process.env.ARENA_DRY_RUN === "true");
    const [rules, prizeWallet, entry] = await Promise.all([
      fetchRules(),
      fetchPrizeWallet(),
      enterNaive({ dryRun }),
    ]);
    return {
      ok: true,
      dryRun,
      rulesName: rules.name,
      prizeWallet: prizeWallet?.wallet?.address ?? prizeWallet,
      entry,
    };
  },
};

export default enterCryptoPulseArenaAction;
