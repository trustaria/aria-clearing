"use client";

import { campaignIdOf, claimsHash, formatClaims, rationaleHash } from "@aria-clearing/receipt";
import type { AdPayload } from "@trustaria/react";
import { useMemo } from "react";
import type { Receipt } from "../../lib/receipt";
import SponsoredCard from "../SponsoredCard";
import { approvedClaims, previewSentence } from "./rules";

const PREVIEW_ID = "preview";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/** The chat's sponsored card with claims 1–2 as the example sentence; nothing is reported and links are inert. */
export default function CardPreview({ brand, claims }: { brand: string; claims: string[] }) {
  const preview = useMemo<{ ad: AdPayload; receipt: Receipt } | null>(() => {
    const approved = approvedClaims(claims);
    const sentence = previewSentence(claims);
    if (!sentence) return null;
    const slug = `${PREVIEW_ID}-${brand}`;
    const advertiser = brand.trim() || "Your brand";
    return {
      ad: {
        requestId: PREVIEW_ID,
        creative: { advertiser, title: advertiser, body: sentence, cta: "Learn more", clickUrl: "#", logoUrl: null },
        disclosure: { label: "Sponsored", whyUrl: "#" },
        impressionToken: PREVIEW_ID,
        ttlMs: PREVIEW_TTL_MS,
      },
      receipt: {
        chainId: 10143,
        contract: "0x0000000000000000000000000000000000000000",
        requestId: PREVIEW_ID,
        campaignId: campaignIdOf(slug),
        claimsHash: claimsHash(formatClaims(approved)),
        rationaleHash: rationaleHash(sentence),
      },
    };
  }, [brand, claims]);

  return (
    <div
      className="rounded-xl border border-stone-200 bg-white px-5 pb-4 pt-4"
      onClickCapture={(e) => e.preventDefault()}
      aria-label="Card preview"
    >
      <div className="space-y-2" aria-hidden>
        <div className="h-2.5 w-11/12 rounded-full bg-stone-100" />
        <div className="h-2.5 w-4/5 rounded-full bg-stone-100" />
        <div className="h-2.5 w-2/3 rounded-full bg-stone-100" />
      </div>
      {preview ? (
        <SponsoredCard ad={preview.ad} receipt={preview.receipt} inert />
      ) : (
        <p className="mt-5 border-l-2 border-neutral-200 pl-3.5 text-sm text-stone-400">Add a claim to see your card.</p>
      )}
    </div>
  );
}
