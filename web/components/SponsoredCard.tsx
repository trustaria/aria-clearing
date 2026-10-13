"use client";

import { AriaAdCard, type AdPayload } from "@trustaria/react";
import { useMemo } from "react";
import { useHoldViews } from "../lib/debug-flags";
import { receiptJson, type Receipt } from "../lib/receipt";

/** Accepts beacons and events and records nothing. */
export const BEACON_SINK = "/api/aria/beacon-sink";
export const CARD_EVENTS_PATH = "/api/aria/card-events";

/** The ad to render: while held, its beacon goes to the sink so the impression is never reported. */
export function adForView(ad: AdPayload, hold: boolean): AdPayload {
  return hold ? { ...ad, beaconUrl: BEACON_SINK } : ad;
}

/**
 * Nova's sponsored card: AriaAdCard themed by the `.nova-ad` variables, with the receipt JSON
 * beside it. `inert` sends its beacon and events to the sink.
 */
export default function SponsoredCard({ ad, receipt, inert = false }: { ad: AdPayload; receipt: Receipt; inert?: boolean }) {
  const hold = useHoldViews() || inert;
  // Stable per ad and hold state, so re-renders do not restart the card's viewability timer.
  const shown = useMemo(() => adForView(ad, hold), [ad, hold]);

  return (
    <div data-aria-card="" className="nova-ad mt-3 rounded-md pr-2 transition hover:bg-neutral-50 dark:hover:bg-neutral-900">
      <AriaAdCard
        ad={shown}
        appearance="blockquote"
        clickArea="card"
        eventsPath={inert ? BEACON_SINK : CARD_EVENTS_PATH}
      />
      <script type="application/json" data-aria-receipt="" dangerouslySetInnerHTML={{ __html: receiptJson(receipt) }} />
    </div>
  );
}
