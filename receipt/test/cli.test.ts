import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { parseCliArgs, SeenMismatchError } from "../src/args";
import { formatReceipt, seenHeadline } from "../src/format";
import { claimsHash, eventIdOf, formatClaims, Kind, rationaleHash, requestKeyOf } from "../src/hash";
import { buildReceipt, type ReceiptInput } from "../src/verify";

const requestId = "req_cli";
const contract = "0xfb6bA8e6c48c806AFC40aFee5F85deE42Ce8F2fb";
const sentence = "Family packages for Lisbon and the Algarve, 3 to 10 nights.";
const claims = formatClaims(["Family packages for Lisbon and the Algarve, 3 to 10 nights."]);
const campaignId = keccak256(toBytes("lisbon"));
const cardReceipt = {
  chainId: 10143,
  contract,
  requestId,
  campaignId,
  claimsHash: claimsHash(claims),
  rationaleHash: rationaleHash(sentence),
};

describe("parseCliArgs", () => {
  it("reads the request id and the chain options", () => {
    const args = parseCliArgs([requestId, "--rpc", "http://x", "--from-block", "12", "--campaign-block", "34"]);

    expect(args).toEqual({
      requestId,
      rpc: "http://x",
      address: undefined,
      fromBlock: 12n,
      campaignBlock: 34n,
      expected: undefined,
      sentenceGiven: false,
    });
  });

  it("requires a request id", () => {
    expect(() => parseCliArgs(["--sentence", "x"])).toThrow(/Missing <requestId>/);
  });

  it("rejects a non-numeric block", () => {
    expect(() => parseCliArgs([requestId, "--from-block", "abc"])).toThrow(/--from-block must be a block number/);
  });

  it("takes the comparable fields of --receipt", () => {
    const args = parseCliArgs([requestId, "--receipt", JSON.stringify(cardReceipt)]);

    expect(args.expected).toEqual({
      chainId: 10143,
      contract,
      campaignId,
      claimsHash: claimsHash(claims),
      rationaleHash: rationaleHash(sentence),
    });
  });

  it("rejects a --receipt for another request", () => {
    const json = JSON.stringify({ ...cardReceipt, requestId: "req_other" });

    expect(() => parseCliArgs([requestId, "--receipt", json])).toThrow(/req_other/);
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["a bad hash", JSON.stringify({ rationaleHash: "0x12" })],
    ["a bad address", JSON.stringify({ contract: "0x12" })],
    ["no comparable field", JSON.stringify({ requestId })],
  ])("rejects a --receipt that is %s", (_, json) => {
    expect(() => parseCliArgs([requestId, "--receipt", json])).toThrow();
  });

  it("hashes --sentence with the card's recipe", () => {
    const args = parseCliArgs([requestId, "--sentence", sentence]);

    expect(args.expected).toEqual({ rationaleHash: rationaleHash(sentence) });
    expect(args.sentenceGiven).toBe(true);
  });

  it("trims and NFC-normalises --sentence before hashing", () => {
    const composed = "Café Lumen: kids stay free.";
    const copied = `  ${composed.normalize("NFD")}  \n`;

    expect(parseCliArgs([requestId, "--sentence", copied]).expected).toEqual({
      rationaleHash: keccak256(toBytes(composed)),
    });
  });

  it("accepts --sentence with a --receipt that embeds its hash", () => {
    const args = parseCliArgs([requestId, "--receipt", JSON.stringify(cardReceipt), "--sentence", sentence]);

    expect(args.expected?.rationaleHash).toBe(rationaleHash(sentence));
  });

  it("reports a --sentence that the --receipt did not embed as a mismatch", () => {
    const run = () => parseCliArgs([requestId, "--receipt", JSON.stringify(cardReceipt), "--sentence", "Other text."]);

    expect(run).toThrow(SeenMismatchError);
    expect(run).toThrow(/Mismatch: rationaleHash/);
  });

  it("rejects an empty --sentence", () => {
    expect(() => parseCliArgs([requestId, "--sentence", "  "])).toThrow(/empty/);
  });
});

describe("formatReceipt", () => {
  const input = (status: 1 | 3 | 4 = 3): ReceiptInput => {
    const eventId = eventIdOf(requestId, Kind.Impression);
    return {
      contract,
      chainId: 10143,
      campaign: {
        campaignId,
        advertiser: "0x00000000000000000000000000000000000000b2",
        claims,
        claimsHash: claimsHash(claims),
        blockNumber: 1n,
        txHash: "0xc0",
      },
      events: [
        {
          eventId,
          requestKey: requestKeyOf(requestId),
          campaignId,
          requestId,
          publisher: "0x00000000000000000000000000000000000000a1",
          kind: Kind.Impression,
          rationale: sentence,
          rationaleHash: rationaleHash(sentence),
          claimRefs: [1],
          price: 10_000n,
          blockNumber: 2n,
          txHash: "0xe1",
        },
      ],
      views: {
        [eventId]: { status, campaignId, publisher: "0x00000000000000000000000000000000000000a1", price: 10_000n, loggedAt: 0n },
      },
      disputed: [],
      settled: [],
    };
  };

  it("leads with the sentence verdict when a sentence was given", () => {
    const receipt = buildReceipt(requestId, input(), { rationaleHash: rationaleHash(sentence) });

    expect(formatReceipt(receipt, { sentenceGiven: true }).split("\n")[0]).toBe(
      "✓ The sentence you saw is the one that was logged and paid for",
    );
  });

  it("does not claim payment for a pending or rejected event", () => {
    const expected = { rationaleHash: rationaleHash(sentence) };

    expect(seenHeadline(buildReceipt(requestId, input(1), expected), { sentenceGiven: true })).toBe(
      "✓ The sentence you saw is the one that was logged; payment awaits verification",
    );
    expect(seenHeadline(buildReceipt(requestId, input(4), expected), { sentenceGiven: true })).toBe(
      "✓ The sentence you saw is the one that was logged, then rejected and not paid",
    );
  });

  it("names the field that differs", () => {
    const receipt = buildReceipt(requestId, input(), { rationaleHash: rationaleHash("Changed sentence.") });
    const lines = formatReceipt(receipt).split("\n");

    expect(lines[0]).toBe("✗ Mismatch: rationaleHash differs from what was logged");
    expect(lines.at(-1)).toBe(lines[0]);
  });

  it("speaks of the card's receipt when the hash came from it rather than from a sentence", () => {
    const receipt = buildReceipt(requestId, input(), { rationaleHash: rationaleHash(sentence) });

    expect(seenHeadline(receipt)).toBe(
      "✓ The card's receipt and the sentence hash it embeds are the ones that were logged and paid for",
    );
  });

  it("speaks of the card's receipt when no sentence hash was compared", () => {
    const receipt = buildReceipt(requestId, input(), { chainId: 10143, contract, campaignId });

    expect(seenHeadline(receipt)).toBe("✓ The card's receipt matches what was logged");
  });

  describe("payment split", () => {
    const eventId = eventIdOf(requestId, Kind.Impression);
    const publisher = "0x00000000000000000000000000000000000000a1";
    const withPayout = (amount: bigint, fee: bigint, deferred = false): ReceiptInput => ({
      ...input(),
      feeBps: 2000,
      payouts: [{ eventId, publisher, amount, fee, deferred, blockNumber: 3n, txHash: "0x51" }],
    });

    it("shows what the publisher received and the Aria fee", () => {
      const lines = formatReceipt(buildReceipt(requestId, withPayout(8_000n, 2_000n))).split("\n");

      expect(lines).toContain("  ✓ publisher amount + Aria fee = price");
      expect(lines).toContain(`      paid  $0.0080 to ${publisher} · Aria fee $0.0020 (20 %)`);
    });

    it("says when the publisher's amount was credited instead of sent", () => {
      const text = formatReceipt(buildReceipt(requestId, withPayout(8_000n, 2_000n, true)));

      expect(text).toContain(`      credited  $0.0080 to ${publisher} (transfer failed, claimable) · Aria fee $0.0020 (20 %)`);
    });

    it("marks a split that does not add up and ends on a mismatch", () => {
      const receipt = buildReceipt(requestId, withPayout(9_000n, 2_000n));
      const lines = formatReceipt(receipt).split("\n");

      expect(receipt.ok).toBe(false);
      expect(lines).toContain("  ✗ publisher amount + Aria fee = price");
      expect(lines.at(-1)).toBe("✗ MISMATCH: the logged event is not internally consistent");
    });

    it("prints sub-cent amounts to the unit", () => {
      const text = formatReceipt(buildReceipt(requestId, { ...withPayout(1n, 0n), feeBps: 2000, events: [{ ...input().events[0], price: 1n }], views: {} }));

      expect(text).toContain(`paid  $0.000001 to ${publisher} · Aria fee $0.0000 (20 %)`);
    });
  });

  it("calls the plain check internal consistency, not verification", () => {
    const text = formatReceipt(buildReceipt(requestId, input()));

    expect(text.split("\n")[0]).toBe(`Receipt for ${requestId}`);
    expect(text).toContain("Internal consistency of the logged event");
    expect(text.split("\n").at(-1)).toMatch(/^✓ Logged event is internally consistent\. Pass --sentence or --receipt/);
    expect(text).not.toContain("✓ verified");
  });
});
