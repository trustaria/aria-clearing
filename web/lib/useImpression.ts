import { useEffect, type RefObject } from "react";
import { createViewTracker, type ViewResult } from "./viewability";

const THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

// requestIds already reported in this page, so remounts never post twice.
const reported = new Set<string>();

function report(requestId: string, result: ViewResult): void {
  fetch("/api/aria/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, kind: "impression", ...result }),
  })
    .then(async (res) => {
      if (!res.ok) console.warn(`impression ${requestId}: ${res.status} ${(await res.json().catch(() => null))?.error ?? ""}`);
    })
    .catch((err: Error) => console.warn(`impression ${requestId}: ${err.message}`));
}

/** Reports one impression once the element is ≥ 50 % visible for ≥ 1000 ms. */
export function useImpression(ref: RefObject<Element>, requestId: string, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || reported.has(requestId) || typeof IntersectionObserver === "undefined") return;

    const view = createViewTracker();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const evaluate = () => {
      clearTimeout(timer);
      const now = Date.now();
      const result = view.check(now);
      if (result) {
        reported.add(requestId);
        stop();
        report(requestId, result);
        return;
      }
      const wait = view.msUntilQualified(now);
      if (wait !== null) timer = setTimeout(evaluate, Math.max(wait, 10));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) view.observe(entry.intersectionRatio, Date.now());
        evaluate();
      },
      { threshold: THRESHOLDS },
    );
    const onVisibility = () => {
      view.setPageVisible(!document.hidden, Date.now());
      evaluate();
    };
    const stop = () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };

    view.setPageVisible(!document.hidden, Date.now());
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibility);
    return stop;
  }, [ref, requestId, enabled]);
}
