import { sendFromRelayer } from "@aria-clearing/ops";
import { ariaClearingAbi, Kind, normalizeRationale } from "@aria-clearing/receipt";
import { encodeFunctionData, type Hex } from "viem";
import { clearingAddress } from "./chain";

const LOG_EVENT_GAS = 300_000;

export type LogEventArgs = {
  requestId: string;
  campaignId: Hex;
  publisher: Hex;
  kind: Kind;
  rationale: string;
  claimRefs: number[];
};

export function logEventCalldata(args: LogEventArgs): Hex {
  return encodeFunctionData({
    abi: ariaClearingAbi,
    functionName: "logEvent",
    args: [
      args.requestId,
      args.campaignId,
      args.publisher,
      args.kind,
      normalizeRationale(args.rationale),
      args.claimRefs,
    ],
  });
}

// One queue on globalThis: route bundles may each hold their own copy of the ops module.
const globalQueue = globalThis as typeof globalThis & { __ariaRelayerQueue?: Promise<unknown> };

/** Sends `logEvent` from the relayer, one tx at a time across all routes; resolves to the tx hash. */
export function sendLogEvent(args: LogEventArgs): Promise<Hex> {
  const previous = globalQueue.__ariaRelayerQueue ?? Promise.resolve();
  const result = previous.then(() =>
    sendFromRelayer({ to: clearingAddress(), data: logEventCalldata(args), gasLimit: LOG_EVENT_GAS }),
  );
  globalQueue.__ariaRelayerQueue = result.catch(() => undefined);
  return result;
}
