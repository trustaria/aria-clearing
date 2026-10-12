import { describe, expect, it } from "vitest";
import { publisherEventsFrom, scanRange, toDashboardJson, type LoggedLog } from "../lib/dashboard-data";

const ME = "0xD2D508841C0C99D31C78C03C94338D88Ca19416b";
const OTHER = "0x1111111111111111111111111111111111111111";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

function log(n: number, publisher: string, kind = 0): LoggedLog {
  return {
    eventId: H(n),
    requestId: `req_${n}`,
    publisher: publisher as `0x${string}`,
    kind,
    price: 10_000n * BigInt(n),
    blockNumber: 1000n + BigInt(n),
    txHash: H(500 + n),
  };
}

describe("publisherEventsFrom", () => {
  it("keeps this publisher's events, newest first, with status from the contract", () => {
    const logs = [log(1, ME), log(2, OTHER), log(3, ME.toLowerCase(), 1)];
    const statuses = { [H(1)]: 3, [H(3)]: 1 };
    expect(publisherEventsFrom(logs, statuses, ME)).toEqual([
      { ...log(3, ME.toLowerCase(), 1), kind: "Click", status: "logged" },
      { ...log(1, ME), kind: "Impression", status: "released" },
    ]);
  });

  it("maps disputed and rejected codes, and falls back to logged", () => {
    const logs = [log(1, ME), log(2, ME), log(3, ME)];
    const statuses = { [H(1)]: 2, [H(2)]: 4 };
    expect(publisherEventsFrom(logs, statuses, ME).map((e) => e.status)).toEqual(["logged", "rejected", "disputed"]);
  });
});

describe("scanRange", () => {
  it("covers the last N blocks but never before the deploy block", () => {
    expect(scanRange(10_000n, 2_000n, 0n)).toEqual({ fromBlock: 8_001n, toBlock: 10_000n });
    expect(scanRange(10_000n, 2_000n, 9_500n)).toEqual({ fromBlock: 9_500n, toBlock: 10_000n });
  });
});

describe("toDashboardJson", () => {
  it("serializes amounts as base-unit strings", () => {
    const json = toDashboardJson(
      { address: ME, mon: 5n, usdc: 20_000n, claimable: 10_000n },
      [{ ...log(1, ME), kind: "Impression", status: "released" }],
      { fromBlock: 1n, toBlock: 2n },
    );
    expect(json).toEqual({
      address: ME,
      mon: "5",
      usdc: "20000",
      claimable: "10000",
      events: [
        {
          eventId: H(1),
          requestId: "req_1",
          publisher: ME,
          kind: "Impression",
          status: "released",
          price: "10000",
          blockNumber: "1001",
          txHash: H(501),
        },
      ],
      fromBlock: "1",
      toBlock: "2",
    });
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
