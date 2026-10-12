import { Kind } from "./hash";
import type { Receipt } from "./verify";

const mark = (pass: boolean) => (pass ? "✓" : "✗");

/** What happened to the money, from the most cautious event. */
function paymentOf(receipt: Receipt): string {
  const statuses = receipt.events.map((e) => e.status);
  if (statuses.includes("rejected")) return ", then rejected and not paid";
  if (statuses.includes("disputed")) return "; it is disputed and not paid";
  if (statuses.includes("logged")) return "; payment awaits verification";
  return " and paid for";
}

export interface FormatOptions {
  /** The expected rationaleHash came from a sentence the reader passed, not only from the card's receipt. */
  sentenceGiven?: boolean;
}

/** One line on whether what the reader saw is what was logged; null when nothing was expected. */
export function seenHeadline(receipt: Receipt, options: FormatOptions = {}): string | null {
  if (receipt.seen === null) return null;
  const differing = receipt.seen.filter((c) => !c.matches).map((c) => c.field);
  if (differing.length > 0) return `✗ Mismatch: ${differing.join(", ")} differs from what was logged`;
  if (!receipt.consistent) return "✗ Mismatch: the logged event is not internally consistent";
  if (options.sentenceGiven) return `✓ The sentence you saw is the one that was logged${paymentOf(receipt)}`;
  if (receipt.seen.some((c) => c.field === "rationaleHash")) {
    return `✓ The card's receipt and the sentence hash it embeds are the ones that were logged${paymentOf(receipt)}`;
  }
  return "✓ The card's receipt matches what was logged";
}

export function formatReceipt(receipt: Receipt, options: FormatOptions = {}): string {
  const lines: string[] = [];
  const headline = seenHeadline(receipt, options);
  const { campaign } = receipt;
  if (headline) lines.push(headline, "");
  lines.push(`Receipt for ${receipt.requestId}`);

  if (receipt.seen !== null) {
    lines.push("");
    lines.push("What you saw vs what was logged");
    for (const check of receipt.seen) {
      const detail = check.matches ? check.expected : `${check.expected}, logged ${check.actual ?? "unknown"}`;
      lines.push(`  ${mark(check.matches)} ${check.field} ${detail}`);
    }
  }

  lines.push("");
  lines.push("Internal consistency of the logged event (the contract computes these hashes itself, so they hold for any event it logged)");
  lines.push(`Campaign ${campaign.campaignId} (advertiser ${campaign.advertiser})`);
  if (campaign.claims === null) {
    lines.push(`  ${mark(campaign.claimsMatch !== false)} claimsHash ${campaign.claimsHash} (claims text not found in the scanned blocks)`);
  } else {
    lines.push(`  ${mark(campaign.claimsMatch === true)} logged claims hash to the campaign's claimsHash`);
    for (const claim of campaign.claims.split("\n")) lines.push(`      ${claim}`);
  }

  for (const event of receipt.events) {
    lines.push("");
    lines.push(`${Kind[event.kind]} ${event.eventId} -> ${event.status}`);
    lines.push(`  ${mark(event.eventIdMatches)} eventId = keccak256(abi.encode(requestId, kind))`);
    lines.push(`  ${mark(event.rationaleMatches)} logged sentence hashes to the logged rationaleHash`);
    lines.push(`  ${mark(event.campaignMatches)} logged against this campaign`);
    lines.push(`  ${mark(event.claimRefsValid)} claimRefs ${JSON.stringify(event.claimRefs)} point at existing claims`);
    lines.push(`      rationale: ${event.rationale}`);
    lines.push(`      rationaleHash: ${event.rationaleHash}`);
    for (const claim of event.citedClaims) lines.push(`      cites: ${claim}`);
    lines.push(`  ${mark(event.viewMatches)} contract state agrees with the logged event`);
    lines.push(`      publisher ${event.publisher}, price ${event.price}`);
  }

  lines.push("");
  lines.push("Lifecycle");
  for (const step of receipt.lifecycle) {
    const detail = step.detail ? ` ${step.detail}` : "";
    lines.push(`  block ${step.blockNumber}  ${step.stage}${detail}  ${step.txHash}`);
  }

  lines.push("");
  if (!receipt.consistent) lines.push("✗ MISMATCH: the logged event is not internally consistent");
  else if (headline) lines.push(headline);
  else lines.push("✓ Logged event is internally consistent. Pass --sentence or --receipt to check what you saw against it.");
  return lines.join("\n");
}
