"use client";

import { useReducer, useRef, useState } from "react";
import type { AdvertiseClient } from "../../lib/advertise-client";
import FundingPanel from "./FundingPanel";
import { IDLE_LAUNCH, reduceLaunch, runWalletLaunch, type TestFundsState } from "./funding";
import { useAdvertiserWallet } from "./useAdvertiserWallet";
import type { WalletLaunchArgs } from "./Wizard";

const UNITS_PER_CENT = 10_000n;
/** Time the finished progress and the escrow link stay on screen before the campaign page opens. */
const LIVE_PAUSE_MS = 2_000;

/** The wallet-funded launch step: the advertiser's wallet balances, test funds and the launch itself. */
export default function WalletLaunch({ client, args }: { client: AdvertiseClient; args: WalletLaunchArgs }) {
  const { budgetCents, input, wallet, onBack, onLaunched, onBusy } = args;
  const funds = useAdvertiserWallet(wallet, BigInt(budgetCents) * UNITS_PER_CENT, true);
  const [testFunds, setTestFunds] = useState<TestFundsState>({ phase: "idle" });
  const [launch, dispatch] = useReducer(reduceLaunch, IDLE_LAUNCH);
  const running = useRef(false);

  const addTestFunds = async () => {
    setTestFunds({ phase: "sending" });
    const result = await client.addTestFunds(budgetCents);
    setTestFunds("error" in result ? { phase: "error", message: result.error } : { phase: "sent" });
    void funds.refresh();
  };

  const start = async () => {
    if (running.current) return;
    running.current = true;
    onBusy(true);
    const ops = {
      ...funds.ops,
      prepare: () => client.prepare(input),
      confirm: (slug: string, txHash: string) => client.confirm(slug, txHash),
    };
    const slug = await runWalletLaunch(ops, dispatch, budgetCents, launch.unconfirmed);
    if (slug) {
      setTimeout(() => onLaunched(slug), LIVE_PAUSE_MS);
      return;
    }
    running.current = false;
    onBusy(false);
    void funds.refresh();
  };

  return (
    <FundingPanel
      budgetCents={budgetCents}
      address={funds.address}
      balances={funds.balances}
      monNeeded={funds.monNeeded}
      checking={funds.checking}
      testFunds={testFunds}
      launch={launch}
      onAddTestFunds={() => void addTestFunds()}
      onCheckAgain={() => void funds.refresh()}
      onBack={onBack}
      onLaunch={() => void start()}
    />
  );
}
