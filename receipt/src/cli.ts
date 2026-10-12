import { existsSync, readFileSync } from "node:fs";
import { isAddress, type Address } from "viem";
import { parseCliArgs, SeenMismatchError, USAGE } from "./args";
import { formatReceipt } from "./format";
import { verifyReceipt } from "./verify";

const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
const DEPLOYMENT_PATH = new URL("../../deployments/10143.json", import.meta.url);

function readDeployment(): { address?: Address; deployBlock?: number } {
  if (!existsSync(DEPLOYMENT_PATH)) return {};
  return JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"));
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  const deployment = readDeployment();
  const address = args.address ?? deployment.address;
  if (!address || !isAddress(address)) throw new Error(`Missing or invalid --address (no deployments/10143.json). ${USAGE}`);
  const fromBlock = args.fromBlock ?? (deployment.deployBlock === undefined ? undefined : BigInt(deployment.deployBlock));

  const receipt = await verifyReceipt(args.requestId, {
    rpcUrl: args.rpc ?? DEFAULT_RPC,
    address,
    fromBlock,
    campaignFromBlock: args.campaignBlock,
    expected: args.expected,
  });
  console.log(formatReceipt(receipt, { sentenceGiven: args.sentenceGiven }));
  process.exitCode = receipt.ok ? 0 : 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = error instanceof SeenMismatchError ? 1 : 2;
});
