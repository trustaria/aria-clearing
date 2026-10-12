"use client";

import { ariaClearingAbi } from "@aria-clearing/receipt";
import { useSendTransaction } from "@privy-io/react-auth";
import { useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { txUrl } from "../../lib/format";

const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

type State = { phase: "idle" } | { phase: "sending" } | { phase: "confirming"; hash: Hex } | { phase: "done"; hash: Hex } | { phase: "error"; message: string; hash?: Hex };

/** Sends claim() from the embedded wallet, waits for the receipt, then calls onClaimed. */
export default function ClaimButton({
  clearing,
  wallet,
  disabled,
  onClaimed,
}: {
  clearing: Address;
  wallet: Address;
  disabled: boolean;
  onClaimed: () => void;
}) {
  const { sendTransaction } = useSendTransaction();
  const [state, setState] = useState<State>({ phase: "idle" });
  const busy = state.phase === "sending" || state.phase === "confirming";

  async function claim() {
    setState({ phase: "sending" });
    let hash: Hex | undefined;
    try {
      const sent = await sendTransaction(
        {
          to: clearing,
          data: encodeFunctionData({ abi: ariaClearingAbi, functionName: "claim" }),
          chainId: monadTestnet.id,
        },
        { address: wallet },
      );
      hash = sent.hash;
      setState({ phase: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Claim reverted");
      setState({ phase: "done", hash });
      onClaimed();
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error), hash });
    }
  }

  const label = state.phase === "sending" ? "Confirm in wallet…" : state.phase === "confirming" ? "Claiming…" : "Claim";
  const hash = "hash" in state ? state.hash : undefined;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={claim}
        disabled={disabled || busy}
        className="w-full rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
      >
        {label}
      </button>
      {state.phase === "done" && <p className="text-sm text-emerald-700">Claimed. USDC is in your wallet.</p>}
      {state.phase === "error" && <p className="text-sm text-rose-700">Claim failed: {state.message.split("\n")[0]}</p>}
      {hash && (
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="block font-mono text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
        >
          View claim tx on MonadVision ↗
        </a>
      )}
    </div>
  );
}
