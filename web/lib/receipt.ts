import {
  campaignIdOf,
  claimsHash,
  formatClaims,
  normalizeRationale,
  rationaleHash,
} from "@aria-clearing/receipt";
import type { Hex } from "viem";
import type { Campaign } from "./campaigns";
import type { Pick } from "./pick";

/** The JSON a card embeds in `<script type="application/json" data-aria-receipt>`. */
export type Receipt = {
  chainId: number;
  contract: string;
  requestId: string;
  campaignId: Hex;
  claimsHash: Hex;
  rationaleHash: Hex;
};

/** Everything the client needs to render one sponsored card. */
export type CardData = {
  requestId: string;
  slug: string;
  advertiser: string;
  rationale: string;
  claimRefs: number[];
  receipt: Receipt;
};

type ReceiptInput = {
  chainId: number;
  contract: string;
  requestId: string;
  campaign: Campaign;
  rationale: string;
};

export function buildReceipt({ chainId, contract, requestId, campaign, rationale }: ReceiptInput): Receipt {
  return {
    chainId,
    contract,
    requestId,
    campaignId: campaignIdOf(campaign.slug),
    claimsHash: claimsHash(formatClaims(campaign.claims)),
    rationaleHash: rationaleHash(rationale),
  };
}

export function buildCard(input: Omit<ReceiptInput, "rationale"> & { pick: Pick }): CardData {
  const rationale = normalizeRationale(input.pick.rationale);
  return {
    requestId: input.requestId,
    slug: input.campaign.slug,
    advertiser: input.campaign.advertiser,
    rationale,
    claimRefs: input.pick.claimRefs,
    receipt: buildReceipt({ ...input, rationale }),
  };
}

/** Receipt JSON safe to inline in a script element. */
export function receiptJson(receipt: Receipt): string {
  return JSON.stringify(receipt).replace(/</g, "\\u003c");
}

export function chainConfig(): { chainId: number; contract: string } {
  return {
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 10143),
    contract: process.env.NEXT_PUBLIC_CLEARING_ADDRESS ?? "",
  };
}
