import type { Metadata } from "next";
import CampaignView from "../../../../components/advertise/CampaignView";
import PrivyProvider from "../../../components/privy-provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aria for advertisers",
};

export default function CampaignPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { new?: string };
}) {
  return (
    <PrivyProvider>
      <main className="min-h-screen bg-[#faf9f6] text-stone-900">
        <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
          <CampaignView slug={params.slug} isNew={searchParams.new === "1"} />
        </div>
      </main>
    </PrivyProvider>
  );
}
