import { Kind, type EventStatus, type Receipt, type ReceiptEvent } from "@aria-clearing/receipt";
import { addressUrl, formatUsdc, txUrl } from "../../lib/format";

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

export interface ReceiptView {
  requestId: string;
  ok: boolean;
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
  verifyCommand: string;
}

export const STATUS: Record<EventStatus, StatusView> = {
  logged: { status: "logged", label: "Logged", tone: "pending", note: "On chain, awaiting verification" },
  disputed: { status: "disputed", label: "Disputed", tone: "warn", note: "Under review before settlement" },
  released: { status: "released", label: "Verified", tone: "good", note: "Evidence checked, paid to the publisher" },
  rejected: { status: "rejected", label: "Rejected", tone: "bad", note: "Evidence failed, budget returned to the advertiser" },
};

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
      label: "Approved claims",
      detail:
        receipt.campaign.claimsMatch === null
          ? "Claims text not found in the scanned blocks"
          : "keccak256(claims) equals the campaign's claimsHash on chain",
      state: checkState(receipt.campaign.claimsMatch),
    },
    {
      key: "sentence",
      label: "Sponsored sentence",
      detail: "keccak256(sentence) equals the logged rationaleHash",
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

function overallStatus(events: ReceiptEvent[]): StatusView {
  const found = STATUS_PRIORITY.find((status) => events.some((e) => e.status === status));
  return STATUS[found ?? "logged"];
}

/** Maps a verified receipt to what the receipt page renders. Pure. */
export function toReceiptView(receipt: Receipt, contract: string): ReceiptView {
  const cited = new Set(receipt.events.flatMap((e) => e.claimRefs));
  const total = receipt.events.reduce((sum, e) => sum + e.price, 0n);
  return {
    requestId: receipt.requestId,
    ok: receipt.ok,
    sentence: receipt.events[0]?.rationale ?? "",
    advertiser: receipt.campaign.advertiser,
    advertiserUrl: addressUrl(receipt.campaign.advertiser),
    campaignId: receipt.campaign.campaignId,
    campaignTxUrl: receipt.campaign.createdTx ? txUrl(receipt.campaign.createdTx) : null,
    contract,
    contractUrl: addressUrl(contract),
    claims: receipt.campaign.claims === null ? null : parseClaims(receipt.campaign.claims, cited),
    checks: checksOf(receipt),
    status: overallStatus(receipt.events),
    totalPrice: formatUsdc(total),
    events: receipt.events.map((event) => ({
      kind: Kind[event.kind],
      eventId: event.eventId,
      status: STATUS[event.status],
      price: formatUsdc(event.price),
      steps: stepsOf(event),
    })),
    final: receipt.events.every((e) => e.status === "released" || e.status === "rejected"),
    verifyCommand: verifyCommand(receipt.requestId),
  };
}
