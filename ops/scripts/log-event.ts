import { ariaClearingAbi, campaignIdOf, Kind, normalizeRationale } from "@aria-clearing/receipt";
import { encodeFunctionData } from "viem";
import { loadEnvFile, requireEnv } from "../src/env";
import { sendFromRelayer } from "../src/relayer";

// Logs one event from the relayer: tsx scripts/log-event.ts <requestId> <slug> <impression|click> <publisher> "<rationale>" [claimRefs]
loadEnvFile();

const [requestId, slug, kindArg, publisher, rationale, refs = ""] = process.argv.slice(2);
if (!requestId || !slug || !kindArg || !publisher || !rationale) {
  console.error('usage: log-event <requestId> <slug> <impression|click> <publisher> "<rationale>" [1,2]');
  process.exit(2);
}

const { NEXT_PUBLIC_CLEARING_ADDRESS } = requireEnv(["NEXT_PUBLIC_CLEARING_ADDRESS"]);
const kind = kindArg === "click" ? Kind.Click : Kind.Impression;
const claimRefs = refs ? refs.split(",").map(Number) : [];

const data = encodeFunctionData({
  abi: ariaClearingAbi,
  functionName: "logEvent",
  args: [requestId, campaignIdOf(slug), publisher as `0x${string}`, kind, normalizeRationale(rationale), claimRefs],
});

const hash = await sendFromRelayer({ to: NEXT_PUBLIC_CLEARING_ADDRESS, data, gasLimit: 300_000 });
console.log(`${kindArg} ${requestId} logged: ${hash}`);
