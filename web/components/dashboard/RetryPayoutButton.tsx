"use client";

import { ariaClearingAbi } from "@aria-clearing/receipt";
import { useSendTransaction } from "@privy-io/react-auth";
import { useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

type Phase = "idle" | "sending" | "done" | "error";

/** Pulls payouts that failed to transfer: sends claim() from the signed-in account, then calls onDone. */
export default function RetryPayoutButton({
  clearing,
  amount,
  onDone,
}: {
  clearing: Address;
  amount: string;
  onDone: () => void;
}) {
  const { sendTransaction } = useSendTransaction();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  async function retry() {
    setPhase("sending");
    try {
      const { hash } = await sendTransaction(
        {
          to: clearing,
          data: encodeFunctionData({ abi: ariaClearingAbi, functionName: "claim" }),
          chainId: monadTestnet.id,
        },
        { uiOptions: { showWalletUIs: false } },
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The payout could not be sent");
      setPhase("done");
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message.split("\n")[0] : String(error));
      setPhase("error");
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4">
      <p className="text-sm text-stone-700">
        A payout of <span className="font-medium text-stone-900">{amount}</span> did not go through.
      </p>
      <button
        type="button"
        onClick={retry}
        disabled={phase === "sending"}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:bg-stone-300"
      >
        {phase === "sending" ? "Retrying…" : "Retry payout"}
      </button>
      <p role="status" className="text-sm">
        {phase === "done" && <span className="text-emerald-700">Payout sent.</span>}
        {phase === "error" && <span className="text-rose-700">Retry failed: {message}</span>}
      </p>
    </div>
  );
}
