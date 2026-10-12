"use client";

import { normalizeRationale } from "@aria-clearing/receipt";
import { useRef } from "react";
import { useHoldViews } from "../lib/debug-flags";
import { receiptJson, type CardData } from "../lib/receipt";
import { useImpression } from "../lib/useImpression";

/** Receipt page link carrying the embedded receipt's hashes, so the page can compare them with the chain. */
function receiptHref(card: CardData): string {
  const query = new URLSearchParams({ h: card.receipt.rationaleHash, c: card.receipt.claimsHash });
  return `/receipt/${encodeURIComponent(card.requestId)}?${query}`;
}

export default function AdCard({ card }: { card: CardData }) {
  const ref = useRef<HTMLElement>(null);
  useImpression(ref, card.requestId, !useHoldViews());

  return (
    <aside ref={ref} data-aria-card="" className="mt-5 border-t border-neutral-200 pt-3 pl-4 text-sm dark:border-neutral-800">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        Sponsored · {card.advertiser}
      </div>
      <p data-aria-rationale="" className="mt-1 text-neutral-700 dark:text-neutral-300">
        {normalizeRationale(card.rationale)}
      </p>
      <div className="mt-1.5 flex gap-4 text-xs">
        <a
          href={`/api/aria/click/${card.requestId}`}
          target="_blank"
          rel="sponsored noopener"
          className="text-neutral-900 underline underline-offset-2 dark:text-neutral-100"
        >
          Visit {card.advertiser}
        </a>
        <a href={receiptHref(card)} className="text-neutral-500 hover:underline">
          Why this ad?
        </a>
      </div>
      <script
        type="application/json"
        data-aria-receipt=""
        dangerouslySetInnerHTML={{ __html: receiptJson(card.receipt) }}
      />
    </aside>
  );
}
