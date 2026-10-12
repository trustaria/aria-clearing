import Link from "next/link";
import type { CampaignStatus, CampaignSummary } from "../../lib/advertise-client";
import { dollars } from "./rules";
import { PRIMARY } from "./ui";

const STATUS: Record<CampaignStatus, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-emerald-500" },
  ending: { label: "Ending", dot: "bg-amber-500" },
  ended: { label: "Ended", dot: "bg-stone-400" },
};

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function Row({ campaign }: { campaign: CampaignSummary }) {
  const status = STATUS[campaign.status];
  return (
    <li>
      <Link
        href={`/advertise/c/${campaign.slug}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-4 transition sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,11rem)_5rem_4rem_1rem]"
      >
        <span className="truncate text-[15px] font-medium text-stone-900">{campaign.advertiser}</span>
        <span className="inline-flex items-center gap-1.5 justify-self-end text-sm text-stone-600 sm:justify-self-auto">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <span className="text-sm tabular-nums text-stone-600">
          {dollars(campaign.spent)} of {dollars(campaign.budget)} spent
        </span>
        <span className="text-right text-sm tabular-nums text-stone-500 sm:text-left">
          <span className="sm:hidden">
            {count(campaign.impressions, "impr.", "impr.")} · {count(campaign.clicks, "click", "clicks")}
          </span>
          <span className="hidden sm:inline">{count(campaign.impressions, "impr.", "impr.")}</span>
        </span>
        <span className="hidden text-sm tabular-nums text-stone-500 sm:inline">{count(campaign.clicks, "click", "clicks")}</span>
        <span aria-hidden className="hidden text-stone-400 transition group-hover:text-stone-900 sm:inline">
          →
        </span>
      </Link>
    </li>
  );
}

/** The signed-in advertiser's campaigns, newest first as the API returns them. */
export default function CampaignList({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Campaigns</h1>
        <Link href="/advertise/new" className={PRIMARY}>
          New campaign
        </Link>
      </div>
      <ul className="divide-y divide-stone-200 border-y border-stone-200">
        {campaigns.map((c) => (
          <Row key={c.slug} campaign={c} />
        ))}
      </ul>
    </div>
  );
}
