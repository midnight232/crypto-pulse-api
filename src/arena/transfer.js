/**
 * Send USDC (SPL) from the prize wallet to a recipient.
 * Creates the recipient ATA if needed (rent paid by prize wallet).
 * Injectable for tests. Never logs secrets.
 */
import {
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  pipe,
  address,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { SOLANA_RPC_URL, USDC_MINT } from "../config.js";
import {
  USDC_DECIMALS,
  loadPrizeSigner,
  getUsdcBalanceAtomic,
  solanaExplorerTxUrl,
} from "./wallet.js";

export function usdcToAtomic(amountUsdc) {
  const n = Number(amountUsdc);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("amount must be positive"), { code: "invalid_amount" });
  }
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

/**
 * Confirm a signature is landed (confirmed/finalized) or failed.
 * @returns {'confirmed'|'failed'|'unknown'}
 */
export async function confirmSignature(signature, { rpc = createSolanaRpc(SOLANA_RPC_URL), attempts = 40, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const st = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const v = st?.value?.[0];
    if (v?.err) return "failed";
    if (v?.confirmationStatus === "confirmed" || v?.confirmationStatus === "finalized") {
      return "confirmed";
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return "unknown";
}

/**
 * Live mainnet/devnet USDC transfer. Returns { signature, explorer }.
 */
export async function sendUsdcTransfer({ recipient, amountUsdc }) {
  const signer = await loadPrizeSigner();
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const mint = address(USDC_MINT);
  const recipientAddr = address(recipient);
  const amount = usdcToAtomic(amountUsdc);

  const bal = await getUsdcBalanceAtomic(signer.address);
  if (bal.amount < amount) {
    throw Object.assign(
      new Error(`insufficient USDC: have ${bal.ui}, need ${amountUsdc}`),
      { code: "insufficient_usdc", have: bal.ui, need: amountUsdc },
    );
  }

  const [sourceAta] = await findAssociatedTokenPda({
    owner: address(signer.address),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const [destAta] = await findAssociatedTokenPda({
    owner: recipientAddr,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });

  const createIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: signer,
    owner: recipientAddr,
    mint,
  });
  const transferIx = getTransferCheckedInstruction({
    source: sourceAta,
    mint,
    destination: destAta,
    authority: signer,
    amount,
    decimals: USDC_DECIMALS,
  });

  const { value: latest } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latest, tx),
    (tx) => appendTransactionMessageInstructions([createIx, transferIx], tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const encoded = getBase64EncodedWireTransaction(signed);
  await rpc.sendTransaction(encoded, { encoding: "base64", skipPreflight: false }).send();

  const status = await confirmSignature(signature, { rpc });
  if (status === "failed") {
    throw Object.assign(new Error("transfer failed on-chain"), {
      code: "transfer_failed",
      signature,
    });
  }
  if (status === "unknown") {
    // Leave as pending for restart reconcile — still return signature.
    return {
      signature,
      explorer: solanaExplorerTxUrl(signature),
      confirmation: "unknown",
    };
  }
  return {
    signature,
    explorer: solanaExplorerTxUrl(signature),
    confirmation: "confirmed",
  };
}
