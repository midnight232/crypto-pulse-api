/**
 * Idempotently create seller + buyer DEVNET USDC ATAs. Fee payer = buyer.
 * Never prints secrets.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { base58 } from "@scure/base";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  pipe,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from "@solana-program/token";
import { USDC_DEVNET_ADDRESS } from "@x402/svm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function loadEnv(role) {
  const text = fs.readFileSync(path.join(ROOT, ".devnet-keys", `${role}.env`), "utf8");
  return {
    address: text.match(/^ADDRESS=(.+)$/m)[1].trim(),
    secret: text.match(/^SECRET_KEY_BASE58=(.+)$/m)[1].trim(),
  };
}

const seller = loadEnv("seller");
const buyer = loadEnv("buyer");
const buyerSigner = await createKeyPairSignerFromBytes(base58.decode(buyer.secret));
const rpc = createSolanaRpc(RPC_URL);
const mint = USDC_DEVNET_ADDRESS;

async function ensureAta(owner) {
  const [ata] = await findAssociatedTokenPda({
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const ix = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: buyerSigner,
    owner,
    mint,
  });
  const { value: latest } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(buyerSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latest, tx),
    (tx) => appendTransactionMessageInstructions([ix], tx),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(signed);
  const encoded = getBase64EncodedWireTransaction(signed);
  await rpc.sendTransaction(encoded, { encoding: "base64" }).send();
  for (let i = 0; i < 30; i++) {
    const st = await rpc.getSignatureStatuses([sig]).send();
    const v = st?.value?.[0];
    if (v?.confirmationStatus === "confirmed" || v?.confirmationStatus === "finalized") break;
    if (v?.err) throw new Error(JSON.stringify(v.err));
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`ATA for ${owner} -> ${ata}`);
  console.log(`tx ${sig}`);
  console.log(`explorer https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

console.log("Creating USDC ATAs on DEVNET (mint", mint + ")");
await ensureAta(seller.address);
await ensureAta(buyer.address);
console.log("Done. Buyer still needs DEVNET USDC from https://faucet.circle.com/ (captcha; not scriptable).");
