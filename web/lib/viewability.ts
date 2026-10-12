/** Share of the card that must be on screen. */
export const MIN_VISIBLE_RATIO = 0.5;
/** Continuous time on screen before an impression counts. */
export const MIN_VIEW_MS = 1000;

export type ViewResult = { viewMs: number; visibleRatio: number };

export type ViewTracker = {
  /** Records the card's current intersection ratio at time `now` (ms). */
  observe(ratio: number, now: number): void;
  /** Records whether the page itself is visible. */
  setPageVisible(visible: boolean, now: number): void;
  /** The measurement once the card has been continuously viewable for MIN_VIEW_MS, else null. */
  check(now: number): ViewResult | null;
  /** Ms left until `check` qualifies, or null while the card is not viewable. */
  msUntilQualified(now: number): number | null;
};

export function createViewTracker(): ViewTracker {
  let ratio = 0;
  let pageVisible = true;
  let maxRatio = 0;
  let visibleSince: number | null = null;

  const update = (now: number) => {
    const viewable = pageVisible && ratio >= MIN_VISIBLE_RATIO;
    if (!viewable) visibleSince = null;
    else if (visibleSince === null) visibleSince = now;
    if (pageVisible) maxRatio = Math.max(maxRatio, ratio);
  };

  return {
    observe(next, now) {
      ratio = Math.min(1, Math.max(0, next));
      update(now);
    },
    setPageVisible(visible, now) {
      pageVisible = visible;
      update(now);
    },
    check(now) {
      if (visibleSince === null || now - visibleSince < MIN_VIEW_MS) return null;
      return { viewMs: now - visibleSince, visibleRatio: Math.round(maxRatio * 1000) / 1000 };
    },
    msUntilQualified(now) {
      if (visibleSince === null) return null;
      return Math.max(0, visibleSince + MIN_VIEW_MS - now);
    },
  };
}
