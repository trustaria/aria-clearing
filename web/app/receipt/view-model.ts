import {
  Kind,
  type EventStatus,
  type ExpectedReceipt,
  type Receipt,
  type ReceiptEvent,
  type SeenCheck,
} from "@aria-clearing/receipt";
import type { PublisherStats } from "../../lib/envio";
import { addressUrl, formatUsdc, shortHash, txUrl } from "../../lib/format";

export type Tone = "pending" | "warn" | "good" | "bad";
export type CheckState = "pass" | "fail" | "unknown";
export type StepState = "done" | "pending" | "failed";

export interface StatusView {
  status: EventStatus;
  label: string;
  tone: Tone;
  note: string;
}

export interface ClaimView {
  number: number;
  text: string;
  cited: boolean;
}

export interface CheckView {
  key: "claims" | "sentence" | "eventId" | "contract";
  label: string;
  detail: string;
  state: CheckState;
}

export interface StepView {
  key: "issued" | "logged" | "disputed" | "verified" | "rejected";
  label: string;
  state: StepState;
  txUrl?: string;
}

export interface EventView {
  kind: string;
  eventId: string;
  status: StatusView;
  price: string;
  steps: StepView[];
}

export interface SeenDifference {
  label: string;
  card: string;
  logged: string;
}

/** Whether the sentence and claims the card showed are the ones logged on chain. */
export interface SeenView {
  /** absent: the page was opened without the card's hashes. */
  state: "match" | "mismatch" | "absent";
  title: string;
  detail: string;
  differences: SeenDifference[];
}

export interface ReceiptView {
  requestId: string;
  ok: boolean;
  /** The logged records agree with each other; says nothing about what the reader saw. */
  consistent: boolean;
  seen: SeenView;
  sentence: string;
  advertiser: string;
  advertiserUrl: string;
  campaignId: string;
  campaignTxUrl: string | null;
  contract: string;
  contractUrl: string;
  claims: ClaimView[] | null;
  checks: CheckView[];
  status: StatusView;
  totalPrice: string;
  events: EventView[];
  /** Every event is released or rejected, so the receipt no longer changes. */
  final: boolean;
  /** The lifecycle of the most cautious event, e.g. "issued → logged → rejected". */
  lifecycleSummary: string;
  verifyCommand: string;
}

export const STATUS: Record<EventStatus, StatusView> = {
  logged: { status: "logged", label: "Logged", tone: "pending", note: "On chain, awaiting verification" },
  disputed: { status: "disputed", label: "Disputed", tone: "warn", note: "Under review before settlement" },
  released: { status: "released", label: "Verified", tone: "good", note: "Evidence checked, paid to the publisher" },
  rejected: {
    status: "rejected",
    label: "Rejected",
    tone: "bad",
    note: "Evidence did not pass verification, budget returned to the advertiser",
  },
};

const DISPUTED_REJECTED: StatusView = { ...STATUS.rejected, note: "Disputed by the advertiser, budget returned" };

/** Most cautious first: one rejected event marks the whole receipt rejected. */
const STATUS_PRIORITY: EventStatus[] = ["rejected", "disputed", "logged", "released"];

const CLAIM_LINE = /^(\d+)\.\s+(.*)$/;

export function verifyCommand(requestId: string): string {
  return `pnpm --filter @aria-clearing/receipt verify ${requestId}`;
}

function parseClaims(claims: string, cited: Set<number>): ClaimView[] {
  return claims.split("\n").map((line, i) => {
    const match = line.match(CLAIM_LINE);
    const number = match ? Number(match[1]) : i + 1;
    return { number, text: match ? match[2] : line, cited: cited.has(number) };
  });
}

function checkState(pass: boolean | null): CheckState {
  if (pass === null) return "unknown";
  return pass ? "pass" : "fail";
}

function checksOf(receipt: Receipt): CheckView[] {
  const all = (test: (e: ReceiptEvent) => boolean) => receipt.events.length > 0 && receipt.events.every(test);
  return [
    {
      key: "claims",
      label: "Logged claims",
      detail:
        receipt.campaign.claimsMatch === null
          ? "Claims text not found in the scanned blocks"
          : "keccak256(logged claims) equals the campaign's claimsHash",
      state: checkState(receipt.campaign.claimsMatch),
    },
    {
      key: "sentence",
      label: "Logged sentence",
      detail: "keccak256(logged sentence) equals the logged rationaleHash",
      state: checkState(all((e) => e.rationaleMatches)),
    },
    {
      key: "eventId",
      label: "Event id",
      detail: "keccak256(abi.encode(requestId, kind)) equals the logged eventId",
      state: checkState(all((e) => e.eventIdMatches)),
    },
    {
      key: "contract",
      label: "Contract state",
      detail: "The contract's record agrees with the logged event and its claims",
      state: checkState(all((e) => e.viewMatches && e.campaignMatches && e.claimRefsValid)),
    },
  ];
}

function stepsOf(event: ReceiptEvent): StepView[] {
  const steps: StepView[] = [
    { key: "issued", label: "Issued", state: "done" },
    { key: "logged", label: "Logged", state: "done", txUrl: txUrl(event.loggedTx) },
  ];
  if (event.status === "disputed" || event.disputedTx) {
    steps.push({
      key: "disputed",
      label: "Disputed",
      state: "done",
      ...(event.disputedTx ? { txUrl: txUrl(event.disputedTx) } : {}),
    });
  }
  const settled = event.settledTx ? { txUrl: txUrl(event.settledTx) } : {};
  if (event.status === "released") steps.push({ key: "verified", label: "Verified · paid", state: "done", ...settled });
  else if (event.status === "rejected") steps.push({ key: "rejected", label: "Rejected", state: "failed", ...settled });
  else steps.push({ key: "verified", label: "Verified", state: "pending" });
  return steps;
}

function wasDisputed(event: ReceiptEvent): boolean {
  return event.status === "disputed" || Boolean(event.disputedTx);
}

function statusOfEvent(event: ReceiptEvent): StatusView {
  return event.status === "rejected" && wasDisputed(event) ? DISPUTED_REJECTED : STATUS[event.status];
}

/** The event that decides the receipt's status: most cautious first. */
function decidingEvent(events: ReceiptEvent[]): ReceiptEvent | undefined {
  const found = STATUS_PRIORITY.find((status) => events.some((e) => e.status === status));
  return events.find((e) => e.status === found);
}

function overallStatus(events: ReceiptEvent[]): StatusView {
  const deciding = decidingEvent(events);
  return deciding ? statusOfEvent(deciding) : STATUS.logged;
}

function lifecycleSummary(events: ReceiptEvent[]): string {
  const deciding = decidingEvent(events);
  const steps = ["issued", "logged"];
  if (deciding && wasDisputed(deciding)) steps.push("disputed");
  if (deciding?.status === "released") steps.push("verified · paid");
  else if (deciding?.status === "rejected") steps.push("rejected");
  else steps.push("awaiting verification");
  return steps.join(" → ");
}

const HASH_PARAM = /^0x[0-9a-fA-F]{64}$/;

/** The card's hashes from the receipt link (`h` sentence, `c` claims); malformed values are dropped. */
export function expectedFromQuery(query: Record<string, string | string[] | undefined>): ExpectedReceipt | undefined {
  const first = (key: string) => {
    const value = query[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text !== undefined && HASH_PARAM.test(text) ? text : undefined;
  };
  const h = first("h");
  const c = first("c");
  if (!h && !c) return undefined;
  return { ...(h ? { rationaleHash: h } : {}), ...(c ? { claimsHash: c } : {}) };
}

const SEEN_LABEL: Partial<Record<SeenCheck["field"], string>> = {
  rationaleHash: "Sentence fingerprint",
  claimsHash: "Claims fingerprint",
};

const ABSENT: SeenView = {
  state: "absent",
  title: "Opened without the card's fingerprint — showing what was logged.",
  detail: "Open this page from the card's “Why this ad?” link to check that the sentence you saw is the one logged on Monad.",
  differences: [],
};

function seenOf(receipt: Receipt): SeenView {
  const seen = receipt.seen;
  if (!seen || seen.length === 0) return ABSENT;
  const differences = seen
    .filter((c) => !c.matches)
    .map((c) => ({
      label: SEEN_LABEL[c.field] ?? c.field,
      card: shortHash(c.expected),
      logged: c.actual === null ? "not found" : shortHash(c.actual),
    }));
  if (differences.length > 0) {
    const sentenceDiffers = seen.some((c) => c.field === "rationaleHash" && !c.matches);
    return {
      state: "mismatch",
      title: sentenceDiffers
        ? "The sentence you saw does not match the one logged on Monad"
        : "The card's claims do not match the ones logged on Monad",
      detail: "The card's fingerprint differs from what was logged, so this receipt does not cover what you saw.",
      differences,
    };
  }
  if (!receipt.consistent) {
    return {
      state: "mismatch",
      title: "The logged record is not internally consistent",
      detail: "The card's fingerprint matches, but the logged record disagrees with itself. See the checks below.",
      differences: [],
    };
  }
  const sentence = seen.some((c) => c.field === "rationaleHash");
  return {
    state: "match",
    title: sentence
      ? "The sentence you saw matches the one logged on Monad"
      : "The claims behind the card match the ones logged on Monad",
    detail: sentence
      ? "The card carried a keccak256 fingerprint of the sentence it showed you; Monad logged the same fingerprint for this request."
      : "The card carried a keccak256 fingerprint of the advertiser's claims; Monad logged the same fingerprint for this campaign.",
    differences: [],
  };
}

/** Maps a verified receipt to what the receipt page renders. Pure. */
const MISMATCH: StatusView = {
  status: "rejected",
  label: "Mismatch",
  tone: "bad",
  note: "This receipt does not cover what the card showed",
};

export function toReceiptView(receipt: Receipt, contract: string): ReceiptView {
  const cited = new Set(receipt.events.flatMap((e) => e.claimRefs));
  const total = receipt.events.reduce((sum, e) => sum + e.price, 0n);
  const seen = seenOf(receipt);
  return {
    requestId: receipt.requestId,
    ok: receipt.ok,
    consistent: receipt.consistent,
    seen,
    sentence: receipt.events[0]?.rationale ?? "",
    advertiser: receipt.campaign.advertiser,
    advertiserUrl: addressUrl(receipt.campaign.advertiser),
    campaignId: receipt.campaign.campaignId,
    campaignTxUrl: receipt.campaign.createdTx ? txUrl(receipt.campaign.createdTx) : null,
    contract,
    contractUrl: addressUrl(contract),
    claims: receipt.campaign.claims === null ? null : parseClaims(receipt.campaign.claims, cited),
    checks: checksOf(receipt),
    status: seen.state === "mismatch" ? MISMATCH : overallStatus(receipt.events),
    lifecycleSummary: lifecycleSummary(receipt.events),
    totalPrice: formatUsdc(total),
    events: receipt.events.map((event) => ({
      kind: Kind[event.kind],
      eventId: event.eventId,
      status: statusOfEvent(event),
      price: formatUsdc(event.price),
      steps: stepsOf(event),
    })),
    final: receipt.events.every((e) => e.status === "released" || e.status === "rejected"),
    verifyCommand: verifyCommand(receipt.requestId),
  };
}

/** Footer line for the publisher's verification rate; null when the indexer has no score. */
export function trustLine(stats: PublisherStats | null): string | null {
  if (!stats || stats.trustScoreBps === null) return null;
  const events = stats.released + stats.rejected + stats.disputed;
  const rate = `${Number((stats.trustScoreBps / 100).toFixed(1))}%`;
  return `Publisher verification rate: ${rate} across ${events.toLocaleString("en-US")} settled ${events === 1 ? "event" : "events"} · indexed by Envio`;
}
