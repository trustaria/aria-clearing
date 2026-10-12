"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SignIn from "../../../components/advertise/SignIn";
import { ConsoleHeader } from "../../../components/advertise/ui";
import { useAdvertiseClient } from "../../../components/advertise/useAdvertiseClient";
import Wizard from "../../../components/advertise/Wizard";

export default function NewCampaignPage() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const router = useRouter();
  const client = useAdvertiseClient();
  const signedIn = ready && authenticated;

  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className={`mx-auto px-4 py-10 sm:px-6 sm:py-14 ${signedIn ? "max-w-5xl" : "max-w-3xl sm:py-16"}`}>
        {!signedIn ? (
          <SignIn ready={ready} onLogin={() => login({ loginMethods: ["email"] })} />
        ) : (
          <div className="space-y-10">
            <ConsoleHeader email={user?.email?.address} onLogout={logout}>
              <Link href="/advertise" className="text-sm text-stone-500 hover:text-stone-900">
                ← Campaigns
              </Link>
            </ConsoleHeader>
            <Wizard client={client} onLaunched={(slug) => router.push(`/advertise/c/${slug}?new=1`)} />
          </div>
        )}
      </div>
    </main>
  );
}
