import { describe, expect, it } from "vitest";
import { MAX_RATIONALE, parsePickJson, pickWithDeadline, validatePick } from "../lib/pick";
import { campaigns, lisbon } from "./fixtures";

const valid = {
  slug: lisbon.slug,
  rationale: "Children under 6 stay free in partner hotels, and every package includes airport transfers.",
  claimRefs: [2, 4],
};

describe("validatePick", () => {
  it("accepts a well-formed pick", () => {
    expect(validatePick(valid, campaigns)).toEqual(valid);
  });

  it("returns null for an unknown slug", () => {
    expect(validatePick({ ...valid, slug: "not-a-campaign" }, campaigns)).toBeNull();
  });

  it("returns null for a null slug (informational question)", () => {
    expect(validatePick({ slug: null, rationale: "", claimRefs: [] }, campaigns)).toBeNull();
  });

  it("drops out-of-range, non-integer and duplicate claim refs", () => {
    const pick = validatePick({ ...valid, claimRefs: [0, 2, 2, 5, 1.5, "3", 4, -1] }, campaigns);
    expect(pick?.claimRefs).toEqual([2, 4]);
  });

  it("returns null when no claim ref is left", () => {
    expect(validatePick({ ...valid, claimRefs: [9] }, campaigns)).toBeNull();
    expect(validatePick({ ...valid, claimRefs: undefined }, campaigns)).toBeNull();
  });

  it("returns null for an empty or blank rationale", () => {
    expect(validatePick({ ...valid, rationale: "" }, campaigns)).toBeNull();
    expect(validatePick({ ...valid, rationale: "   \n" }, campaigns)).toBeNull();
    expect(validatePick({ ...valid, rationale: 42 }, campaigns)).toBeNull();
  });

  it("returns null for a rationale over the length limit", () => {
    expect(validatePick({ ...valid, rationale: "a".repeat(MAX_RATIONALE + 1) }, campaigns)).toBeNull();
    expect(validatePick({ ...valid, rationale: "a".repeat(MAX_RATIONALE) }, campaigns)).not.toBeNull();
  });

  it("normalizes the rationale (trim, NFC)", () => {
    const pick = validatePick({ ...valid, rationale: "  Café nearby.  " }, campaigns);
    expect(pick?.rationale).toBe("Café nearby.");
  });

  it("returns null for non-objects", () => {
    expect(validatePick(null, campaigns)).toBeNull();
    expect(validatePick("lisbon", campaigns)).toBeNull();
  });
});

describe("parsePickJson", () => {
  it("parses a bare JSON object", () => {
    expect(parsePickJson('{"slug":null,"rationale":"","claimRefs":[]}')).toEqual({
      slug: null,
      rationale: "",
      claimRefs: [],
    });
  });

  it("extracts the object from surrounding text or code fences", () => {
    expect(parsePickJson('```json\n{"slug":"x","rationale":"y","claimRefs":[1]}\n```')).toEqual({
      slug: "x",
      rationale: "y",
      claimRefs: [1],
    });
  });

  it("throws on unparseable output", () => {
    expect(() => parsePickJson("no json here")).toThrow();
  });
});

describe("pickWithDeadline", () => {
  it("returns the result when it arrives in time", async () => {
    expect(await pickWithDeadline(async () => "ok", 100)).toBe("ok");
  });

  it("returns null when the call is slower than the deadline, and aborts it", async () => {
    let aborted = false;
    const started = Date.now();
    const result = await pickWithDeadline(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => (aborted = true));
          setTimeout(() => resolve("late"), 500);
        }),
      50,
    );
    expect(result).toBeNull();
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("returns null when the call throws", async () => {
    expect(
      await pickWithDeadline(async () => {
        throw new Error("boom");
      }, 100),
    ).toBeNull();
  });
});
