import type { CampaignStatsJson, RejectReason, SentenceJson, SentenceStatus } from "../../../lib/advertiser-data";
import type { CampaignStatus } from "../../../lib/campaign-store";
import { addressUrl, formatDollars, formatPercent, timeAgo, txUrl } from "../../../lib/format";
import { NO_ACTIONS, type Actions, type DisputeState } from "./actions";

/** USDC units (6 decimals) per US cent. */
const UNITS_PER_CENT = 10_000n;

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
  /** This page's dispute of the sentence, if any. */
  dispute: DisputeState | null;
}

export interface CampaignView {
  brand: string;
  status: { label: string; tone: Tone };
  cards: StatCard[];
  verification: string;
  sentences: SentenceRow[];
  claims: string[];
  remaining: string;
  /** True while the End block is shown: live, or ending from this page. */
  endable: boolean;
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
  pending: { label: "Launching", tone: "pending" },
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

function statusOf(json: CampaignStatsJson, actions: Actions): CampaignStatus {
  if (json.status === "ended" || actions.end.phase === "ended") return "ended";
  if (actions.end.phase === "sending") return "ending";
  return json.status;
}

/** "Ended. $X returned." from the stats, else from this page's End; null while not ended. */
function endedNotice(json: CampaignStatsJson, actions: Actions): string | null {
  if (json.status === "ended") return `Ended. ${formatDollars(BigInt(json.funds.refunded))} returned.`;
  if (actions.end.phase === "ended") {
    return `Ended. ${formatDollars(BigInt(actions.end.refunded) * UNITS_PER_CENT)} returned.`;
  }
  return null;
}

/** A sentence this page disputed reads as disputed before the next poll confirms it. */
function sentenceOf(s: SentenceJson, dispute: DisputeState | null): SentenceJson {
  return s.status === "being_verified" && dispute?.phase === "sent"
    ? { ...s, status: "disputed", disputeSecondsLeft: 0 }
    : s;
}

/**
 * Maps the stats route's JSON and this page's actions to what the campaign page renders; `now` is unix seconds.
 * Pure.
 */
export function toCampaignView(json: CampaignStatsJson, now: number, actions: Actions = NO_ACTIONS): CampaignView {
  const { funds, counts } = json;
  const remaining = formatDollars(BigInt(funds.remaining));
  const status = statusOf(json, actions);
  return {
    brand: json.brand,
    status: STATUS[status],
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
    sentences: json.sentences.map((raw) => {
      const dispute = actions.disputes[raw.eventId] ?? null;
      const s = sentenceOf(raw, dispute);
      return {
        eventId: s.eventId,
        quote: s.rationale,
        meta: sentenceMeta(s, now),
        tone: SENTENCE_STATUS[s.status].tone,
        receiptUrl: receiptUrl(s.requestId),
        disputeSecondsLeft: s.disputeSecondsLeft,
        dispute,
      };
    }),
    claims: json.claims,
    remaining,
    endable: status === "live" || (status === "ending" && actions.end.phase === "sending"),
    endedNotice: endedNotice(json, actions),
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
