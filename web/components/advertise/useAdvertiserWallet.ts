"use client";

import { useSendTransaction } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  type Address,
  type Hex,
} from "viem";
import { monadTestnet } from "viem/chains";
import type { Prepared, WalletInfo } from "../../lib/advertise-client";
import { FALLBACK_GAS, feeFor, withMargin } from "../../lib/wallet-gas";
import type { Balances, LaunchOps } from "./funding";

const POLL_MS = 5_000;
const RECEIPT_TIMEOUT_MS = 60_000;

const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

/** One contract call from the advertiser's wallet; `description` shows in Privy's confirmation modal. */
export type WalletCall = { to: Address; data: Hex; description: string };

/**
 * Sends calls from the signed-in user's Privy embedded wallet (`address`, else the default embedded wallet).
 * Gas limit is the RPC estimate plus 20 %, passed explicitly with the current fees; the estimate runs the call, so
 * a revert surfaces before the wallet prompt. Resolves with the hash once mined; rejects on a revert.
 */
export function useWalletSender(address?: string | null) {
  const { sendTransaction } = useSendTransaction();
  const sendRef = useRef(sendTransaction);
  sendRef.current = sendTransaction;

  return useCallback(
    async (call: WalletCall, from: Address): Promise<Hex> => {
      const [estimate, fees] = await Promise.all([
        publicClient.estimateGas({ account: from, to: call.to, data: call.data }),
        publicClient.estimateFeesPerGas(),
      ]);
      const { hash } = await sendRef.current(
        {
          to: call.to,
          data: call.data,
          chainId: monadTestnet.id,
          gasLimit: withMargin(estimate),
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        },
        { address: address ?? from, uiOptions: { showWalletUIs: true, description: call.description } },
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
      return hash;
    },
    [address],
  );
}

/**
 * The advertiser's embedded wallet for a launch of `budget` USDC units: balances, allowance and the MON the
 * remaining launch transactions need, refreshed every 5 s while `active`, plus the wallet steps of a launch.
 */
export function useAdvertiserWallet(info: WalletInfo | null, budget: bigint, active: boolean) {
  const address = info?.address && isAddress(info.address) ? getAddress(info.address) : null;
  const clearing = info && isAddress(info.clearing) ? getAddress(info.clearing) : null;
  const usdc = info && isAddress(info.usdc) ? getAddress(info.usdc) : null;
  const send = useWalletSender(address);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [monNeeded, setMonNeeded] = useState<bigint | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (!address || !clearing || !usdc) return;
    setChecking(true);
    try {
      const [held, mon, allowance, fees] = await Promise.all([
        publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        publicClient.getBalance({ address }),
        publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [address, clearing] }),
        publicClient.estimateFeesPerGas(),
      ]);
      // createCampaign can't be estimated before the USDC and the allowance are in place, so it uses its fixed limit.
      const limits: bigint[] = [FALLBACK_GAS.createCampaign];
      if (allowance < budget) {
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [clearing, budget] });
        const approve = await publicClient
          .estimateGas({ account: address, to: usdc, data })
          .then(withMargin)
          .catch(() => FALLBACK_GAS.approve);
        limits.push(approve);
      }
      setBalances({ usdc: held, mon });
      setMonNeeded(feeFor(limits, fees.maxFeePerGas));
    } catch {
      // Keeps the last values; the next poll tries again.
    } finally {
      setChecking(false);
    }
  }, [address, clearing, usdc, budget]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const ops = useMemo((): Pick<LaunchOps, "allowance" | "approve" | "createCampaign"> => {
    const from = (prepared: Prepared): Address => {
      if (!address || !isAddressEqual(prepared.wallet as Address, address)) throw new Error("Wallet mismatch");
      return address;
    };
    return {
      allowance: (prepared) =>
        publicClient.readContract({
          address: getAddress(prepared.usdc),
          abi: erc20Abi,
          functionName: "allowance",
          args: [from(prepared), getAddress(prepared.clearing)],
        }),
      approve: (prepared) =>
        send(
          {
            to: getAddress(prepared.usdc),
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [getAddress(prepared.clearing), BigInt(prepared.budget)],
            }),
            description: "Let Aria's escrow contract take your campaign budget",
          },
          from(prepared),
        ),
      createCampaign: (prepared) =>
        send(
          { to: getAddress(prepared.clearing), data: prepared.createCampaignData, description: "Move your budget into escrow" },
          from(prepared),
        ),
    };
  }, [address, send]);

  return { address, balances, monNeeded, checking, refresh, ops };
}
