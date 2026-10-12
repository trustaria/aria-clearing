import { describe, expect, it } from "vitest";
import { validatePick } from "../lib/pick";
import { stubPick } from "../lib/stub";
import { campaigns, lisbon } from "./fixtures";

describe("stubPick", () => {
  it("picks the Lisbon campaign for the Lisbon question", () => {
    const raw = stubPick("Planning 5 days in Lisbon with two kids, what should I book first?", campaigns);
    const pick = validatePick(raw, campaigns);
    expect(pick?.slug).toBe(lisbon.slug);
    expect(pick?.claimRefs.length).toBeGreaterThan(0);
  });

  it("builds the rationale only from the cited claims", () => {
    const pick = validatePick(stubPick("Family trip to Lisbon next spring", campaigns), campaigns)!;
    const cited = pick.claimRefs.map((n) => lisbon.claims[n - 1]);
    expect(pick.rationale).toBe(cited.join(" "));
  });

  it("returns null for an informational question", () => {
    const raw = stubPick("What's the difference between RAM and storage?", campaigns);
    expect(validatePick(raw, campaigns)).toBeNull();
  });
});
