import { appendEnv, envFilePath, loadEnvFile, requireEnv } from "../src/env";
import { privyClient } from "../src/privy";

loadEnvFile();

if (process.env.RELAYER_WALLET_ID) {
  console.log(`Relayer already exists: ${process.env.RELAYER_ADDRESS ?? "(RELAYER_ADDRESS missing)"}`);
  process.exit(0);
}

const { PRIVY_AUTHORIZATION_ID } = requireEnv(["PRIVY_AUTHORIZATION_ID"]);

const wallet = await privyClient().wallets().create({
  chain_type: "ethereum",
  owner_id: PRIVY_AUTHORIZATION_ID,
  display_name: "Aria relayer",
});

if (wallet.owner_id !== PRIVY_AUTHORIZATION_ID) {
  throw new Error(`Wallet ${wallet.id} created but its owner is not the authorization key`);
}

appendEnv({ RELAYER_WALLET_ID: wallet.id, RELAYER_ADDRESS: wallet.address });
console.log(`Relayer created: ${wallet.address}`);
console.log(`Wallet id and address appended to ${envFilePath()}`);
