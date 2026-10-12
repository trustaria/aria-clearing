import { describe, expect, it } from "vitest";
import { createViewTracker, MIN_VIEW_MS } from "../lib/viewability";

describe("view tracker", () => {
  it("qualifies after 1000 ms at 50 % or more and reports viewMs and the max ratio", () => {
    const view = createViewTracker();
    view.observe(0.6, 0);
    view.observe(0.95, 300);
    expect(view.check(999)).toBeNull();
    expect(view.check(1000)).toEqual({ viewMs: 1000, visibleRatio: 0.95 });
  });

  it("does not count time below 50 %", () => {
    const view = createViewTracker();
    view.observe(0.49, 0);
    expect(view.check(5000)).toBeNull();
    expect(view.msUntilQualified(5000)).toBeNull();
  });

  it("restarts the timer when the card drops below 50 %", () => {
    const view = createViewTracker();
    view.observe(0.8, 0);
    view.observe(0.2, 900);
    view.observe(0.7, 1000);
    expect(view.check(1900)).toBeNull();
    expect(view.msUntilQualified(1900)).toBe(100);
    expect(view.check(2000)).toEqual({ viewMs: 1000, visibleRatio: 0.8 });
  });

  it("treats a hidden page as not visible", () => {
    const view = createViewTracker();
    view.observe(1, 0);
    view.setPageVisible(false, 500);
    expect(view.check(2000)).toBeNull();
    view.setPageVisible(true, 2000);
    expect(view.check(2000 + MIN_VIEW_MS)).toEqual({ viewMs: MIN_VIEW_MS, visibleRatio: 1 });
  });

  it("rounds and clamps the ratio", () => {
    const view = createViewTracker();
    view.observe(0.987654, 0);
    expect(view.check(1000)?.visibleRatio).toBe(0.988);
  });
});
