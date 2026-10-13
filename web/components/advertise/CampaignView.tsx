"use client";

import { ariaClearingAbi } from "@aria-clearing/receipt";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useRef } from "react";
import { encodeFunctionData, getAddress, isAddress, type Hex } from "viem";
import type { CampaignStatsJson } from "../../lib/advertiser-data";
import { walletDispute, walletEnd } from "./campaign/actions";
import CampaignPanel, { Eyebrow } from "./campaign/CampaignPanel";
import { useAdvertiseClient } from "./useAdvertiseClient";
import { useWalletSender } from "./useAdvertiserWallet";

type Funding = Pick<CampaignStatsJson, "funding"> & { clearing?: string; advertiser?: string };

/** One advertiser campaign: asks for sign-in, then shows the panel fed by the owner-only stats route. */
export default function CampaignView({ slug, isNew }: { slug: string; isNew: boolean }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const client = useAdvertiseClient();
  const send = useWalletSender();
  // Held in a ref so a new function identity from Privy does not restart polling.
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  // Who signs Dispute and End, from the latest stats.
  const funding = useRef<Funding>({});

  const fetchStats = useCallback(async () => {
    const token = await tokenRef.current();
    const res = await fetch(`/api/advertise/campaigns/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      res
        .clone()
        .json()
        .then((json: CampaignStatsJson) => {
          funding.current = { funding: json.funding, clearing: json.account?.clearing, advertiser: json.account?.treasury };
        })
        .catch(() => undefined);
    }
    return res;
  }, [slug]);

  /** Sends a call to the clearing contract from the campaign's advertiser wallet. */
  const sendToClearing = useCallback(
    (data: Hex, description: string) => {
      const { clearing, advertiser } = funding.current;
      if (!clearing || !advertiser || !isAddress(clearing) || !isAddress(advertiser)) {
        return Promise.reject(new Error("Campaign wallet unknown"));
      }
      return send({ to: getAddress(clearing), data, description }, getAddress(advertiser));
    },
    [send],
  );

  const dispute = useCallback(
    (eventId: string) => {
      if (funding.current.funding !== "wallet") return client.dispute(slug, eventId);
      return walletDispute(eventId, {
        send: (id) =>
          sendToClearing(
            encodeFunctionData({ abi: ariaClearingAbi, functionName: "dispute", args: [id as Hex] }),
            "Dispute this ad",
          ),
        report: (id, txHash) => client.dispute(slug, id, txHash),
      });
    },
    [client, slug, sendToClearing],
  );

  const end = useCallback(() => {
    if (funding.current.funding !== "wallet") return client.endCampaign(slug);
    return walletEnd({
      begin: () => client.beginWalletEnd(slug),
      withdraw: (campaignId) =>
        sendToClearing(
          encodeFunctionData({ abi: ariaClearingAbi, functionName: "withdraw", args: [campaignId as Hex] }),
          "Return your remaining budget",
        ),
      finish: (txHash) => client.finishWalletEnd(slug, txHash),
      cancel: () => client.cancelWalletEnd(slug),
    });
  }, [client, slug, sendToClearing]);

  if (!ready || !authenticated) {
    return (
      <div className="space-y-8">
        <Eyebrow />
        <div className="space-y-3">
          <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Sign in to see this campaign.</h1>
          <p className="text-[15px] text-stone-600">We email you a one-time code. No password.</p>
        </div>
        <button
          type="button"
          onClick={() => login({ loginMethods: ["email"] })}
          disabled={!ready}
          className="rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:bg-stone-300"
        >
          {ready ? "Sign in" : "Loading…"}
        </button>
      </div>
    );
  }

  return <CampaignPanel isNew={isNew} fetchStats={fetchStats} onDispute={dispute} onEnd={end} />;
}
