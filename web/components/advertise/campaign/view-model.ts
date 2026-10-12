import type { CampaignStatsJson, RejectReason, SentenceJson, SentenceStatus } from "../../../lib/advertiser-data";
import type { CampaignStatus } from "../../../lib/campaign-store";
import { addressUrl, formatDollars, formatPercent, timeAgo, txUrl } from "../../../lib/format";

export type Tone = "good" | "pending" | "warn" | "bad" | "idle";

export interface StatCard {
  key: "spent" | "remaining" | "pending" | "impressions" | "clicks" | "ctr";
  label: string;
  value: string;
  hint: string | null;
}

export interface SentenceRow {
  eventId: string;
  quote: string;
  meta: string;
  tone: Tone;
  receiptUrl: string;
  disputeSecondsLeft: number;
}

export interface CampaignView {
  brand: string;
  status: { label: string; tone: Tone };
  cards: StatCard[];
  verification: string;
  sentences: SentenceRow[];
  claims: string[];
  remaining: string;
  /** "Ended. $X returned." once the campaign has ended. */
  endedNotice: string | null;
  account: {
    campaignId: string;
    treasury: string;
    treasuryUrl: string;
    txHash: string;
    txUrl: string;
    clearing: string;
    clearingUrl: string;
    network: string;
  };
}

const STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  live: { label: "Live", tone: "good" },
  ending: { label: "Ending", tone: "warn" },
  ended: { label: "Ended", tone: "idle" },
};

export const REASONS: Record<RejectReason, string> = {
  not_viewed: "not viewed",
  no_redirect: "click not completed",
  disputed: "disputed",
};

const SENTENCE_STATUS: Record<SentenceStatus, { label: string; tone: Tone }> = {
  verified: { label: "verified", tone: "good" },
  being_verified: { label: "being verified", tone: "pending" },
  disputed: { label: "disputed · being verified", tone: "warn" },
  rejected: { label: "rejected", tone: "bad" },
};

/** Age in seconds under a minute ("12 s ago"), else the shared coarse format. */
export function ago(time: number, now: number): string {
  const seconds = Math.max(0, Math.round(now - time));
  return seconds < 60 ? `${seconds} s ago` : timeAgo(time, now);
}

export function receiptUrl(requestId: string): string {
  return `/receipt/${encodeURIComponent(requestId)}`;
}

/** "Verified 50 · Being verified 1 · Rejected 2 (not viewed 1, disputed 1)". */
export function verificationLine(counts: CampaignStatsJson["counts"]): string {
  const reasons = (Object.keys(REASONS) as RejectReason[])
    .filter((r) => counts.rejectedBy[r] > 0)
    .map((r) => `${REASONS[r]} ${counts.rejectedBy[r]}`);
  const rejected = `Rejected ${counts.rejected}${reasons.length ? ` (${reasons.join(", ")})` : ""}`;
  return `Verified ${counts.verified} · Being verified ${counts.beingVerified} · ${rejected}`;
}

/** "Click · verified · $0.25 · 12 s ago"; a rejected row names the reason instead of a price. */
export function sentenceMeta(s: SentenceJson, now: number): string {
  const status = SENTENCE_STATUS[s.status].label;
  const middle = s.status === "rejected" ? `${status} · ${REASONS[s.reason ?? "not_viewed"]}` : `${status} · ${formatDollars(BigInt(s.price))}`;
  return `${s.kind} · ${middle} · ${ago(s.time, now)}`;
}

/** Maps the stats route's JSON to what the campaign page renders; `now` is unix seconds. Pure. */
export function toCampaignView(json: CampaignStatsJson, now: number): CampaignView {
  const { funds, counts } = json;
  const remaining = formatDollars(BigInt(funds.remaining));
  return {
    brand: json.brand,
    status: STATUS[json.status],
    cards: [
      { key: "spent", label: "Spent", value: formatDollars(BigInt(funds.spent)), hint: `of ${formatDollars(BigInt(funds.budget))}` },
      { key: "remaining", label: "Remaining", value: remaining, hint: null },
      { key: "pending", label: "Pending", value: formatDollars(BigInt(funds.pending)), hint: "being verified" },
      { key: "impressions", label: "Impressions", value: counts.impressions.toLocaleString("en-US"), hint: null },
      { key: "clicks", label: "Clicks", value: counts.clicks.toLocaleString("en-US"), hint: null },
      {
        key: "ctr",
        label: "CTR",
        value: formatPercent(counts.impressions === 0 ? null : counts.clicks / counts.impressions),
        hint: null,
      },
    ],
    verification: verificationLine(counts),
    sentences: json.sentences.map((s) => ({
      eventId: s.eventId,
      quote: s.rationale,
      meta: sentenceMeta(s, now),
      tone: SENTENCE_STATUS[s.status].tone,
      receiptUrl: receiptUrl(s.requestId),
      disputeSecondsLeft: s.disputeSecondsLeft,
    })),
    claims: json.claims,
    remaining,
    endedNotice: json.status === "ended" ? `Ended. ${formatDollars(BigInt(funds.refunded))} returned.` : null,
    account: {
      campaignId: json.account.campaignId,
      treasury: json.account.treasury,
      treasuryUrl: addressUrl(json.account.treasury),
      txHash: json.account.txHash,
      txUrl: txUrl(json.account.txHash),
      clearing: json.account.clearing,
      clearingUrl: addressUrl(json.account.clearing),
      network: json.account.network,
    },
  };
}
