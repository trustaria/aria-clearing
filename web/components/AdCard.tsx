import { normalizeRationale } from "@aria-clearing/receipt";
import { receiptJson, type CardData } from "../lib/receipt";

export default function AdCard({ card }: { card: CardData }) {
  return (
    <aside data-aria-card="" className="mt-5 border-t border-neutral-200 pt-3 pl-4 text-sm dark:border-neutral-800">
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
        <a href={`/receipt/${card.requestId}`} className="text-neutral-500 hover:underline">
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
