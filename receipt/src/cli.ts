import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isAddress, type Address } from "viem";
import { Kind } from "./hash";
import { verifyReceipt, type Receipt } from "./verify";

const DEFAULT_RPC = "https://testnet-rpc.monad.xyz";
const DEPLOYMENT_PATH = new URL("../../deployments/10143.json", import.meta.url);

const USAGE = "Usage: verify <requestId> [--rpc URL] [--address 0x..] [--from-block N] [--campaign-block N]";

const mark = (pass: boolean) => (pass ? "✓" : "✗");

function readDeployment(): { address?: Address; deployBlock?: number } {
  if (!existsSync(DEPLOYMENT_PATH)) return {};
  return JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"));
}

export function formatReceipt(receipt: Receipt): string {
  const lines: string[] = [];
  const { campaign } = receipt;
  lines.push(`Receipt for ${receipt.requestId}`);
  lines.push(`Campaign ${campaign.campaignId} (advertiser ${campaign.advertiser})`);
  if (campaign.claims === null) {
    lines.push(`  ${mark(campaign.claimsMatch !== false)} claimsHash ${campaign.claimsHash} (claims text not found in the scanned blocks)`);
  } else {
    lines.push(`  ${mark(campaign.claimsMatch === true)} claimsHash matches keccak256(claims) and the on-chain campaign`);
    for (const claim of campaign.claims.split("\n")) lines.push(`      ${claim}`);
  }

  for (const event of receipt.events) {
    lines.push("");
    lines.push(`${Kind[event.kind]} ${event.eventId} -> ${event.status}`);
    lines.push(`  ${mark(event.eventIdMatches)} eventId = keccak256(abi.encode(requestId, kind))`);
    lines.push(`  ${mark(event.rationaleMatches)} rationaleHash matches the emitted rationale`);
    lines.push(`  ${mark(event.campaignMatches)} logged against this campaign`);
    lines.push(`  ${mark(event.claimRefsValid)} claimRefs ${JSON.stringify(event.claimRefs)} point at existing claims`);
    lines.push(`      rationale: ${event.rationale}`);
    for (const claim of event.citedClaims) lines.push(`      cites: ${claim}`);
    lines.push(`  ${mark(event.viewMatches)} contract state agrees with the logged event`);
    lines.push(`      publisher ${event.publisher}, price ${event.price}`);
  }

  lines.push("");
  lines.push("Lifecycle");
  for (const step of receipt.lifecycle) {
    const detail = step.detail ? ` ${step.detail}` : "";
    lines.push(`  block ${step.blockNumber}  ${step.stage}${detail}  ${step.txHash}`);
  }

  lines.push("");
  lines.push(receipt.ok ? "✓ verified" : "✗ MISMATCH: this receipt does not match the chain data");
  return lines.join("\n");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      rpc: { type: "string" },
      address: { type: "string" },
      "from-block": { type: "string" },
      "campaign-block": { type: "string" },
    },
  });

  const requestId = positionals[0];
  if (!requestId) throw new Error(USAGE);

  const deployment = readDeployment();
  const address = values.address ?? deployment.address;
  if (!address || !isAddress(address)) throw new Error(`Missing or invalid --address (no deployments/10143.json). ${USAGE}`);
  const fromBlock = values["from-block"] ?? deployment.deployBlock;

  const receipt = await verifyReceipt(requestId, {
    rpcUrl: values.rpc ?? DEFAULT_RPC,
    address,
    fromBlock: fromBlock === undefined ? undefined : BigInt(fromBlock),
    campaignFromBlock: values["campaign-block"] === undefined ? undefined : BigInt(values["campaign-block"]),
  });
  console.log(formatReceipt(receipt));
  process.exitCode = receipt.ok ? 0 : 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 2;
});
