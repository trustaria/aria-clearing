import { ariaClearingAbi } from "@aria-clearing/receipt";
import { appendEnv, loadEnvFile, requireEnv } from "../src/env";
import { relayerPolicy } from "../src/policy";
import { authorizationContext, privyClient } from "../src/privy";

loadEnvFile();

if (!process.env.NEXT_PUBLIC_CLEARING_ADDRESS) {
  console.error("NEXT_PUBLIC_CLEARING_ADDRESS is not set. Deploy AriaClearing first, then run privy:policy.");
  process.exit(1);
}

const env = requireEnv(["NEXT_PUBLIC_CLEARING_ADDRESS", "PRIVY_AUTHORIZATION_ID", "RELAYER_WALLET_ID"]);
const policy = relayerPolicy({ clearingAddress: env.NEXT_PUBLIC_CLEARING_ADDRESS, abi: ariaClearingAbi });
const privy = privyClient();

let policyId = process.env.RELAYER_POLICY_ID;
if (policyId) {
  await privy.policies().update(policyId, {
    name: policy.name,
    rules: policy.rules,
    authorization_context: authorizationContext(),
  });
  console.log(`Policy ${policyId} updated`);
} else {
  const created = await privy.policies().create({ ...policy, owner_id: env.PRIVY_AUTHORIZATION_ID });
  policyId = created.id;
  appendEnv({ RELAYER_POLICY_ID: policyId });
  console.log(`Policy ${policyId} created`);
}

const wallet = await privy.wallets().update(env.RELAYER_WALLET_ID, {
  policy_ids: [policyId],
  authorization_context: authorizationContext(),
});
console.log(`Relayer ${wallet.address} enforces policies: ${wallet.policy_ids.join(", ")}`);
console.log(`Allowed: logEvent to ${env.NEXT_PUBLIC_CLEARING_ADDRESS} on eip155:10143. Everything else is denied.`);
