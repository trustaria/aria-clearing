import { writeFileSync } from "node:fs";
import { ariaClearingAbi } from "@aria-clearing/receipt";
import { APIError } from "@privy-io/node";
import { appendEnv, loadEnvFile, requireEnv } from "../src/env";
import {
  MONAD_TESTNET_CAIP2,
  MONAD_TESTNET_CHAIN_ID,
  normalizeAddress,
  relayerPolicy,
  testTransferPolicy,
} from "../src/policy";
import { authorizationContext, privyClient } from "../src/privy";

// Probes the policy engine on a throwaway wallet that may only transact with DEPLOYER_ADDRESS.
// Usage: privy:probe [output.json]

loadEnvFile();

const env = requireEnv(["PRIVY_AUTHORIZATION_ID", "DEPLOYER_ADDRESS"]);
const privy = privyClient();
const deployer = normalizeAddress(env.DEPLOYER_ADDRESS);
const outsider = "0x000000000000000000000000000000000000dead";

let policyId = process.env.PRIVY_TEST_POLICY_ID;
if (!policyId) {
  const policy = await privy.policies().create({
    ...testTransferPolicy({ recipient: deployer }),
    owner_id: env.PRIVY_AUTHORIZATION_ID,
  });
  policyId = policy.id;
  appendEnv({ PRIVY_TEST_POLICY_ID: policyId });
}

let walletId = process.env.PRIVY_TEST_WALLET_ID;
if (!walletId) {
  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    owner_id: env.PRIVY_AUTHORIZATION_ID,
    policy_ids: [policyId],
    display_name: "Aria policy probe",
  });
  walletId = wallet.id;
  appendEnv({ PRIVY_TEST_WALLET_ID: walletId, PRIVY_TEST_ADDRESS: wallet.address });
}
const wallet = await privy.wallets().get(walletId);

function signOnly(to: string) {
  return privy.wallets().ethereum().signTransaction(walletId!, {
    authorization_context: authorizationContext(),
    params: {
      transaction: {
        type: 2,
        chain_id: MONAD_TESTNET_CHAIN_ID,
        nonce: 0,
        to,
        value: "0x0",
        gas_limit: "0x5208",
        max_fee_per_gas: "0x2e90edd000",
        max_priority_fee_per_gas: "0x77359400",
      },
    },
  });
}

function send(to: string, { value = "0x0", sponsor = false } = {}) {
  return privy.wallets().ethereum().sendTransaction(walletId!, {
    caip2: MONAD_TESTNET_CAIP2,
    authorization_context: authorizationContext(),
    params: { transaction: { to, value, chain_id: MONAD_TESTNET_CHAIN_ID } },
    ...(sponsor && { sponsor: true }),
  });
}

async function attempt(name: string, run: () => Promise<unknown>) {
  try {
    return { name, ok: true, result: await run() };
  } catch (err) {
    if (err instanceof APIError) {
      return { name, ok: false, status: err.status, errorName: err.name, message: err.message, body: err.error };
    }
    return { name, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const milliMon = "0x38d7ea4c68000";
const upperDeployer = `0x${deployer.slice(2).toUpperCase()}`;
const results = [
  await attempt("sign: outsider (expect policy denial)", () => signOnly(outsider)),
  await attempt("sign: deployer lowercase (expect allowed)", () => signOnly(deployer)),
  await attempt("sign: deployer uppercase hex (case sensitivity)", () => signOnly(upperDeployer)),
  await attempt("send: outsider, unfunded", () => send(outsider)),
  await attempt("send: deployer, unfunded", () => send(deployer)),
  await attempt("send: outsider 0.001 MON, unfunded", () => send(outsider, { value: milliMon })),
  await attempt("send: deployer 0.001 MON, unfunded", () => send(deployer, { value: milliMon })),
  await attempt("send: deployer, sponsor=true", () => send(deployer, { sponsor: true })),
  await attempt("relayer policy accepted by Privy (placeholder address, deleted after)", async () => {
    const created = await privy.policies().create(relayerPolicy({ clearingAddress: outsider, abi: ariaClearingAbi }));
    await privy.policies().delete(created.id, {});
    return { id: created.id, rules: created.rules.length, deleted: true };
  }),
];

const report = {
  wallet: { id: wallet.id, address: wallet.address, policy_ids: wallet.policy_ids, owner_id: wallet.owner_id },
  policyId,
  allowedRecipient: deployer,
  results,
};
const out = JSON.stringify(report, null, 2);
console.log(out);
if (process.argv[2]) writeFileSync(process.argv[2], out);
