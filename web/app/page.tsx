import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Landing from "../components/landing/Landing";
import RecentReceipt from "../components/landing/RecentReceipt";
import { ARIA_ICONS } from "../lib/brand-icons";
import { deployment } from "../lib/deployment";
import { chatRedirect, type SearchParams } from "../lib/root-redirect";

// Reads the deployment and ENVIO_GRAPHQL_URL at request time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Aria Clearing demo" },
  icons: ARIA_ICONS,
};

export default function LandingPage({ searchParams }: { searchParams?: SearchParams }) {
  const chat = chatRedirect(searchParams);
  if (chat) redirect(chat);
  return (
    <Landing
      contract={deployment().clearing}
      envioUrl={process.env.ENVIO_GRAPHQL_URL || null}
      recentReceipt={
        <Suspense fallback={null}>
          <RecentReceipt />
        </Suspense>
      }
    />
  );
}
