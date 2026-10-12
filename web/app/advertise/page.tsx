"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CampaignList from "../../components/advertise/CampaignList";
import SignIn from "../../components/advertise/SignIn";
import { ConsoleHeader } from "../../components/advertise/ui";
import { useAdvertiseClient } from "../../components/advertise/useAdvertiseClient";
import type { CampaignSummary } from "../../lib/advertise-client";

export default function AdvertisePage() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const router = useRouter();
  const client = useAdvertiseClient();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed in: load the list, or go straight to the wizard when there is nothing to list.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let live = true;
    client
      .listCampaigns()
      .then(({ campaigns }) => {
        if (!live) return;
        if (campaigns.length === 0) router.replace("/advertise/new");
        else setCampaigns(campaigns);
      })
      .catch(() => live && setError("Could not load your campaigns. Refresh to try again."));
    return () => {
      live = false;
    };
  }, [ready, authenticated, client, router]);

  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        {!ready || !authenticated ? (
          <SignIn ready={ready} onLogin={() => login({ loginMethods: ["email"] })} />
        ) : (
          <div className="space-y-10">
            <ConsoleHeader email={user?.email?.address} onLogout={logout} />
            {error ? (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : campaigns ? (
              <CampaignList campaigns={campaigns} />
            ) : (
              <div className="space-y-3" aria-busy="true">
                <div className="h-9 w-40 animate-pulse rounded-lg bg-stone-200/60" />
                <div className="h-14 animate-pulse rounded-lg bg-white" />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
