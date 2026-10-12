import { encodeFunctionData, erc20Abi } from "viem";
import { loadEnvFile, requireEnv } from "../src/env";
import { MONAD_TESTNET_USDC } from "../src/policy";
import { privyErrorCode, sendFromWallet } from "../src/relayer";

// Checks that the treasury policy denies USDC moves outside AriaClearing; exits 1 if any request is not denied.

loadEnvFile();

const env = requireEnv(["TREASURY_WALLET_ID", "DEPLOYER_ADDRESS"]);
const deployer = env.DEPLOYER_ADDRESS as `0x${string}`;
const outsider = "0x000000000000000000000000000000000000dEaD";

const requests = [
  {
    name: "USDC transfer(deployer, 1 unit)",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [deployer, 1n] }),
  },
  {
    name: "USDC approve(outsider, 1 unit)",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [outsider, 1n] }),
  },
];

let failures = 0;
for (const request of requests) {
  try {
    const tx = { to: MONAD_TESTNET_USDC, data: request.data, gasLimit: 100_000 };
    const hash = await sendFromWallet(env.TREASURY_WALLET_ID, tx);
    failures++;
    console.log(`${request.name}: NOT denied, sent ${hash}`);
  } catch (err) {
    const code = privyErrorCode(err);
    if (code !== "policy_violation") failures++;
    console.log(`${request.name}: denied, code=${code ?? "none"}, ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failures > 0 ? 1 : 0);
