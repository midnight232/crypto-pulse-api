/**
 * Generate throwaway Solana DEVNET seller + buyer wallets.
 * Secrets go to .devnet-keys/*.env (gitignored, chmod 600). Never prints secret keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nacl from "tweetnacl";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".devnet-keys");

async function makeWallet(name) {
  const kp = nacl.sign.keyPair();
  const signer = await createKeyPairSignerFromBytes(kp.secretKey);
  const content = [
    `# DEVNET ONLY — throwaway test key — NEVER use on mainnet`,
    `# role: ${name}`,
    `# network: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 (devnet)`,
    `ADDRESS=${signer.address}`,
    `SECRET_KEY_BASE58=${base58.encode(kp.secretKey)}`,
  ].join("\n") + "\n";
  const file = path.join(DIR, `${name}.env`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return signer.address;
}

fs.mkdirSync(DIR, { recursive: true });
fs.chmodSync(DIR, 0o700);
const seller = await makeWallet("seller");
const buyer = await makeWallet("buyer");
fs.writeFileSync(
  path.join(DIR, "README.txt"),
  "DEVNET ONLY throwaway wallets. Never commit. Never use on mainnet. chmod 600.\n",
  { mode: 0o600 },
);
console.log("Wrote DEVNET-ONLY wallets to .devnet-keys/ (secrets not printed)");
console.log("seller_address", seller);
console.log("buyer_address", buyer);
