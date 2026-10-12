"use client";

import { campaignIdOf, claimsHash, formatClaims, rationaleHash } from "@aria-clearing/receipt";
import { useEffect, useMemo, useRef } from "react";
import { setHoldViews, useHoldViews } from "../../lib/debug-flags";
import type { CardData } from "../../lib/receipt";
import AdCard from "../AdCard";
import { approvedClaims, previewSentence } from "./rules";

const PREVIEW_ID = "preview";

/** The chat's sponsored card with claims 1–2 as the example sentence; views are not reported and links are inert. */
export default function CardPreview({ brand, claims }: { brand: string; claims: string[] }) {
  const held = useHoldViews();
  const heldBefore = useRef(held);

  useEffect(() => {
    const prior = heldBefore.current;
    setHoldViews(true);
    return () => setHoldViews(prior);
  }, []);

  const card = useMemo<CardData | null>(() => {
    const approved = approvedClaims(claims);
    const sentence = previewSentence(claims);
    if (!sentence) return null;
    const slug = `${PREVIEW_ID}-${brand}`;
    return {
      requestId: PREVIEW_ID,
      slug,
      advertiser: brand.trim() || "Your brand",
      rationale: sentence,
      claimRefs: approved.length > 1 ? [1, 2] : [1],
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
      {card ? (
        <AdCard card={card} />
      ) : (
        <p className="mt-5 border-t border-neutral-200 pl-4 pt-3 text-sm text-stone-400">Add a claim to see your card.</p>
      )}
    </div>
  );
}
