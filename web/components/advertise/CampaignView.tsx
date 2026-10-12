"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useRef } from "react";
import CampaignPanel, { Eyebrow } from "./campaign/CampaignPanel";

/** One advertiser campaign: asks for sign-in, then shows the panel fed by the owner-only stats route. */
export default function CampaignView({ slug, isNew }: { slug: string; isNew: boolean }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  // Held in a ref so a new function identity from Privy does not restart polling.
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  const fetchStats = useCallback(async () => {
    const token = await tokenRef.current();
    return fetch(`/api/advertise/campaigns/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }, [slug]);

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

  return <CampaignPanel isNew={isNew} fetchStats={fetchStats} />;
}
