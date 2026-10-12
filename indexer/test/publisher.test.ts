import { describe, expect, it } from "vitest";
import { emptyPublisher, moveEvent, trustScoreBps } from "../src/publisher.js";

describe("trustScoreBps", () => {
  it("is undefined with no settled or disputed events", () => {
    expect(trustScoreBps({ released: 0, rejected: 0, disputed: 0 })).toBeUndefined();
  });

  it("divides released by released + rejected + disputed", () => {
    expect(trustScoreBps({ released: 2, rejected: 0, disputed: 0 })).toBe(10_000);
    expect(trustScoreBps({ released: 1, rejected: 1, disputed: 0 })).toBe(5_000);
    expect(trustScoreBps({ released: 2, rejected: 1, disputed: 1 })).toBe(5_000);
    expect(trustScoreBps({ released: 0, rejected: 3, disputed: 0 })).toBe(0);
  });

  it("rounds half up to whole basis points", () => {
    expect(trustScoreBps({ released: 2, rejected: 1, disputed: 0 })).toBe(6_667);
    expect(trustScoreBps({ released: 1, rejected: 2, disputed: 0 })).toBe(3_333);
    expect(trustScoreBps({ released: 1, rejected: 0, disputed: 7 })).toBe(1_250);
  });
});

describe("moveEvent", () => {
  it("keeps each event in exactly one bucket through logged, disputed, rejected", () => {
    let p = moveEvent(emptyPublisher("0xabc"), undefined, "pending", 10);
    expect(p).toMatchObject({ pending: 1, disputed: 0, rejected: 0, trustScoreBps: undefined });
    p = moveEvent(p, "pending", "disputed", 20);
    expect(p).toMatchObject({ pending: 0, disputed: 1, rejected: 0, trustScoreBps: 0 });
    p = moveEvent(p, "disputed", "rejected", 30);
    expect(p).toMatchObject({ pending: 0, disputed: 0, rejected: 1, trustScoreBps: 0, lastActivityAt: 30 });
  });

  it("never moves lastActivityAt backwards", () => {
    const p = moveEvent({ ...emptyPublisher("0xabc"), pending: 1, lastActivityAt: 50 }, "pending", "released", 40);
    expect(p.lastActivityAt).toBe(50);
    expect(p.trustScoreBps).toBe(10_000);
  });
});
