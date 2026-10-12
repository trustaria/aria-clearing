import type { ActivityStatus, DashboardJson, KindName, RejectReason } from "../../lib/dashboard-data";
import { addressUrl, formatDollars, formatMon, formatPercent, publisherKey, timeAgo } from "../../lib/format";
import type { Tone } from "../receipt/view-model";

export interface CardView {
  key: "earnings" | "pending" | "impressions" | "clicks" | "ctr" | "rejected" | "verification";
  label: string;
  value: string;
  hint: string;
}

export interface FeedRow {
  eventId: string;
  sentence: string;
  tone: Tone;
  when: string;
  receiptUrl: string;
}

export interface DashboardView {
  cards: CardView[];
  balance: string;
  /** Failed payouts waiting for a retry; null when there are none. */
  retryAmount: string | null;
  feed: FeedRow[];
  /** The verification rate card is shown, so account details credit its source. */
  hasVerificationRate: boolean;
  publisherId: string;
  latestReceiptUrl: string | null;
  account: {
    address: string;
    addressUrl: string;
    clearing: string;
    clearingUrl: string;
    mon: string;
    blocks: string;
  };
}

export const REASONS: Record<RejectReason, { short: string; sentence: string }> = {
  not_viewed: { short: "not viewed", sentence: "the ad was never on screen" },
  no_redirect: { short: "no click redirect", sentence: "the click did not go through the ad link" },
  disputed: { short: "disputed by advertiser", sentence: "disputed by the advertiser" },
};

const TONES: Record<ActivityStatus, Tone> = {
  paid: "good",
  deferred: "warn",
  pending: "pending",
  disputed: "warn",
  rejected: "bad",
};

interface SentenceInput {
  kind: KindName;
  advertiser: string | null;
  status: ActivityStatus;
  earned: bigint;
  reason: RejectReason | null;
}

/** One activity row as a plain sentence, e.g. "Click on “Tagus Family Travel” — verified, $0.25 paid". */
export function activitySentence(item: SentenceInput): string {
  const subject = item.advertiser ? `${item.kind} on “${item.advertiser}”` : item.kind;
  switch (item.status) {
    case "paid":
      return `${subject} — verified, ${formatDollars(item.earned)} paid`;
    case "deferred":
      return `${subject} — verified, ${formatDollars(item.earned)} payout waiting for a retry`;
    case "pending":
      return `${subject} — awaiting verification`;
    case "disputed":
      return `${subject} — disputed by the advertiser, under review`;
    case "rejected":
      return `${subject} — rejected: ${REASONS[item.reason ?? "not_viewed"].sentence}`;
  }
}

/** Non-zero rejection reasons in one line, e.g. "2 not viewed · 1 no click redirect". */
export function rejectedSummary(rejectedBy: Record<RejectReason, number>): string {
  const parts = (Object.keys(REASONS) as RejectReason[])
    .filter((reason) => rejectedBy[reason] > 0)
    .map((reason) => `${rejectedBy[reason]} ${REASONS[reason].short}`);
  return parts.length ? parts.join(" · ") : "Nothing rejected";
}

/** Clicks per impression as a fraction; null with no impressions. */
export function ctr(impressions: number, clicks: number): number | null {
  return impressions === 0 ? null : clicks / impressions;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

export function receiptUrl(requestId: string): string {
  return `/receipt/${encodeURIComponent(requestId)}`;
}

/** Basis points as a percentage without trailing zeros, e.g. 10000 → "100%", 9550 → "95.5%". */
export function formatRate(bps: number): string {
  return `${Number((bps / 100).toFixed(1))}%`;
}

/** Overview card for the share of verified ads; null when the rate is unknown. */
export function verificationCard(bps: number | null | undefined): CardView | null {
  if (bps === null || bps === undefined) return null;
  return {
    key: "verification",
    label: "Verification rate",
    value: formatRate(bps),
    hint: "Share of your ads verified by Chainlink",
  };
}

/** Maps the publisher route's JSON to what the dashboard renders; `now` is unix seconds. Pure. */
export function toDashboardView(json: DashboardJson, now: number): DashboardView {
  const { totals } = json;
  const shown = totals.impressions;
  const credit = BigInt(json.credit);
  const verification = verificationCard(json.trustScoreBps);
  return {
    cards: [
      { key: "earnings", label: "Earnings", value: formatDollars(BigInt(totals.paid)), hint: "Paid out to you" },
      {
        key: "pending",
        label: "Pending verification",
        value: formatDollars(BigInt(totals.pending)),
        hint: totals.pendingCount ? `${plural(totals.pendingCount, "event")} being checked` : "Nothing waiting",
      },
      { key: "impressions", label: "Impressions", value: shown.toLocaleString("en-US"), hint: "Ads seen in your app" },
      { key: "clicks", label: "Clicks", value: totals.clicks.toLocaleString("en-US"), hint: "Through the ad link" },
      {
        key: "ctr",
        label: "CTR",
        value: formatPercent(ctr(shown, totals.clicks)),
        hint: "Clicks per impression",
      },
      {
        key: "rejected",
        label: "Rejected",
        value: totals.rejected.toLocaleString("en-US"),
        hint: rejectedSummary(totals.rejectedBy),
      },
      ...(verification ? [verification] : []),
    ],
    hasVerificationRate: verification !== null,
    balance: formatDollars(BigInt(json.usdc)),
    retryAmount: credit > 0n ? formatDollars(credit) : null,
    feed: json.activity.map((item) => ({
      eventId: item.eventId,
      sentence: activitySentence({ ...item, earned: BigInt(item.earned) }),
      tone: TONES[item.status],
      when: timeAgo(item.time, now),
      receiptUrl: receiptUrl(item.requestId),
    })),
    publisherId: publisherKey(json.address),
    latestReceiptUrl: json.activity[0] ? receiptUrl(json.activity[0].requestId) : null,
    account: {
      address: json.address,
      addressUrl: addressUrl(json.address),
      clearing: json.clearing,
      clearingUrl: addressUrl(json.clearing),
      mon: formatMon(BigInt(json.mon)),
      blocks: `${json.fromBlock}–${json.toBlock}`,
    },
  };
}
