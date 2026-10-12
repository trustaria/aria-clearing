import { createPublicClient, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, maxUint256 } from "viem";
import { appendEnv, envFilePath, loadEnvFile, requireEnv } from "../src/env";
import { MONAD_TESTNET_USDC, treasuryPolicy } from "../src/policy";
import { authorizationContext, privyClient } from "../src/privy";
import { sendFromWallet } from "../src/relayer";

// Sets up the advertiser treasury: policy, server wallet, and a one-time max USDC approve to AriaClearing.
// Re-runnable: each step is skipped when already done.

loadEnvFile();

if (!process.env.NEXT_PUBLIC_CLEARING_ADDRESS) {
  console.error("NEXT_PUBLIC_CLEARING_ADDRESS is not set. Deploy AriaClearing first, then run privy:treasury.");
  process.exit(1);
}

const env = requireEnv(["NEXT_PUBLIC_CLEARING_ADDRESS", "PRIVY_AUTHORIZATION_ID", "MONAD_TESTNET_RPC_URL"]);
const clearing = env.NEXT_PUBLIC_CLEARING_ADDRESS as `0x${string}`;
const usdc = MONAD_TESTNET_USDC;
const policy = treasuryPolicy({ clearingAddress: clearing, usdcAddress: usdc });
const privy = privyClient();

let policyId = process.env.TREASURY_POLICY_ID;
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
  appendEnv({ TREASURY_POLICY_ID: policyId });
  console.log(`Policy ${policyId} created`);
}

let walletId = process.env.TREASURY_WALLET_ID;
if (!walletId) {
  const created = await privy.wallets().create({
    chain_type: "ethereum",
    owner_id: env.PRIVY_AUTHORIZATION_ID,
    policy_ids: [policyId],
    display_name: "Aria advertiser treasury",
  });
  if (created.owner_id !== env.PRIVY_AUTHORIZATION_ID) {
    throw new Error(`Wallet ${created.id} created but its owner is not the authorization key`);
  }
  walletId = created.id;
  appendEnv({ TREASURY_WALLET_ID: walletId, TREASURY_ADDRESS: created.address });
  console.log(`Treasury created; id and address appended to ${envFilePath()}`);
}

const wallet = await privy.wallets().update(walletId, {
  policy_ids: [policyId],
  authorization_context: authorizationContext(),
});
const treasury = wallet.address as `0x${string}`;
console.log(`Treasury ${treasury} enforces policies: ${wallet.policy_ids.join(", ")}`);
console.log(`Allowed on eip155:10143: USDC approve (spender AriaClearing), createCampaign, dispute, withdraw.`);

const rpc = createPublicClient({ transport: http(env.MONAD_TESTNET_RPC_URL) });
const readAllowance = () =>
  rpc.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [treasury, clearing] });

const [mon, usdcBalance, allowance] = await Promise.all([
  rpc.getBalance({ address: treasury }),
  rpc.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }),
  readAllowance(),
]);
console.log(`Balances: ${formatEther(mon)} MON, ${formatUnits(usdcBalance, 6)} USDC`);

if (allowance === maxUint256) {
  console.log("USDC allowance to AriaClearing is already max");
} else if (mon === 0n) {
  console.log(`Fund ${treasury} with MON (and USDC), then re-run to approve AriaClearing.`);
} else {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [clearing, maxUint256] });
  const hash = await sendFromWallet(walletId, { to: usdc, data, gasLimit: 150_000 });
  console.log(`approve(AriaClearing, max) sent: ${hash}`);
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`approve ${hash} reverted`);
  console.log(`USDC allowance to AriaClearing: ${(await readAllowance()) === maxUint256 ? "max" : "below max"}`);
}
