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
    // The Visit link stretches over the whole card, so any click on it is the tracked click.
    <aside
      ref={ref}
      data-aria-card=""
      className="group relative mt-5 cursor-pointer rounded-md border-t border-neutral-200 pt-3 pb-2 pl-4 pr-2 text-sm transition hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
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
          className="text-neutral-900 underline underline-offset-2 after:absolute after:inset-0 after:content-[''] dark:text-neutral-100"
        >
          Visit {card.advertiser}
        </a>
        <a
          href={receiptHref(card)}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 text-neutral-500 hover:underline"
        >
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
