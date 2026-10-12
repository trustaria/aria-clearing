import { Kind, withExpected, type Receipt, type ReceiptEvent } from "@aria-clearing/receipt";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { expectedFromQuery, STATUS, toReceiptView, trustLine } from "../app/receipt/view-model";
import ReceiptDocument from "../components/receipt/ReceiptDocument";

const CONTRACT = "0xeCED10b07169857eE91441BBDdeb9653bF7cC041";
const PUBLISHER = "0xD2D508841C0C99D31C78C03C94338D88Ca19416b";
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

const CLAIMS = [
  "1. Family packages for Lisbon and the Algarve, 3 to 10 nights.",
  "2. Children under 6 stay free in partner hotels.",
  "3. Free cancellation up to 48 hours before arrival.",
  "4. Every package includes airport transfers.",
].join("\n");

function event(overrides: Partial<ReceiptEvent>): ReceiptEvent {
  return {
    kind: Kind.Impression,
    eventId: TX(100),
    eventIdMatches: true,
    publisher: PUBLISHER,
    rationale: "Family packages for Lisbon with free stays for kids under 6.",
    rationaleHash: TX(200),
    rationaleMatches: true,
    claimRefs: [1, 2],
    citedClaims: [],
    claimRefsValid: true,
    viewMatches: true,
    campaignMatches: true,
    price: 10_000n,
    status: "released",
    loggedTx: TX(1),
    settledTx: TX(2),
    ...overrides,
  };
}

function receipt(overrides: Partial<Receipt> = {}, events: ReceiptEvent[] = [event({})]): Receipt {
  return {
    requestId: "req_fixture",
    ok: true,
    consistent: true,
    seen: null,
    campaign: {
      campaignId: TX(300),
      advertiser: "0x00000000000000000000000000000000000000ad",
      claims: CLAIMS,
      claimsHash: TX(400),
      claimsMatch: true,
      createdTx: TX(5),
    },
    events,
    lifecycle: [],
    ...overrides,
  };
}

describe("status labels", () => {
  it("maps every chain status to a label and a tone", () => {
    expect(STATUS.logged).toMatchObject({ label: "Logged", tone: "pending" });
    expect(STATUS.disputed).toMatchObject({ label: "Disputed", tone: "warn" });
    expect(STATUS.released).toMatchObject({ label: "Verified", tone: "good" });
    expect(STATUS.rejected).toMatchObject({ label: "Rejected", tone: "bad" });
  });
});

describe("toReceiptView", () => {
  it("shows the exact sentence and highlights the cited claims by number", () => {
    const view = toReceiptView(receipt(), CONTRACT);
    expect(view.sentence).toBe("Family packages for Lisbon with free stays for kids under 6.");
    expect(view.claims).toEqual([
      { number: 1, text: "Family packages for Lisbon and the Algarve, 3 to 10 nights.", cited: true },
      { number: 2, text: "Children under 6 stay free in partner hotels.", cited: true },
      { number: 3, text: "Free cancellation up to 48 hours before arrival.", cited: false },
      { number: 4, text: "Every package includes airport transfers.", cited: false },
    ]);
  });

  it("cites a claim referenced by any of the events", () => {
    const view = toReceiptView(
      receipt({}, [event({ claimRefs: [2] }), event({ kind: Kind.Click, eventId: TX(101), claimRefs: [4] })]),
      CONTRACT,
    );
    expect(view.claims!.filter((c) => c.cited).map((c) => c.number)).toEqual([2, 4]);
  });

  it("passes all four checks for a matching receipt", () => {
    const view = toReceiptView(receipt(), CONTRACT);
    expect(view.checks.map((c) => [c.key, c.state])).toEqual([
      ["claims", "pass"],
      ["sentence", "pass"],
      ["eventId", "pass"],
      ["contract", "pass"],
    ]);
    expect(view.ok).toBe(true);
  });

  it("fails the sentence check when the rationale does not hash to the logged hash", () => {
    const view = toReceiptView(receipt({ ok: false }, [event({ rationaleMatches: false })]), CONTRACT);
    expect(view.checks.find((c) => c.key === "sentence")!.state).toBe("fail");
    expect(view.ok).toBe(false);
  });

  it("fails the contract check when the view, campaign or claim refs disagree", () => {
    for (const bad of [{ viewMatches: false }, { campaignMatches: false }, { claimRefsValid: false }]) {
      const view = toReceiptView(receipt({ ok: false }, [event(bad)]), CONTRACT);
      expect(view.checks.find((c) => c.key === "contract")!.state).toBe("fail");
    }
  });

  it("reports the claims check as unknown when the claims text was not found", () => {
    const base = receipt();
    const view = toReceiptView({ ...base, campaign: { ...base.campaign, claims: null, claimsMatch: null } }, CONTRACT);
    expect(view.checks.find((c) => c.key === "claims")!.state).toBe("unknown");
    expect(view.claims).toBeNull();
  });

  it("formats prices in USDC and sums them", () => {
    const view = toReceiptView(
      receipt({}, [event({}), event({ kind: Kind.Click, eventId: TX(101), price: 50_000n })]),
      CONTRACT,
    );
    expect(view.events.map((e) => [e.kind, e.price])).toEqual([
      ["Impression", "0.01"],
      ["Click", "0.05"],
    ]);
    expect(view.totalPrice).toBe("0.06");
  });

  it("walks a released event through issued, logged and verified with tx links", () => {
    const [released] = toReceiptView(receipt(), CONTRACT).events;
    expect(released.status.label).toBe("Verified");
    expect(released.steps).toEqual([
      { key: "issued", label: "Issued", state: "done" },
      { key: "logged", label: "Logged", state: "done", txUrl: `https://testnet.monadvision.com/tx/${TX(1)}` },
      { key: "verified", label: "Verified · paid", state: "done", txUrl: `https://testnet.monadvision.com/tx/${TX(2)}` },
    ]);
  });

  it("ends a rejected event on a failed step", () => {
    const [rejected] = toReceiptView(receipt({}, [event({ status: "rejected" })]), CONTRACT).events;
    expect(rejected.steps.at(-1)).toMatchObject({ key: "rejected", label: "Rejected", state: "failed" });
  });

  it("leaves verification pending for a logged event and inserts a dispute step", () => {
    const view = toReceiptView(
      receipt({}, [event({ status: "logged", settledTx: undefined }), event({ kind: Kind.Click, eventId: TX(101), status: "disputed", settledTx: undefined, disputedTx: TX(9) })]),
      CONTRACT,
    );
    expect(view.events[0].steps.at(-1)).toMatchObject({ key: "verified", state: "pending" });
    expect(view.events[1].steps.map((s) => s.key)).toEqual(["issued", "logged", "disputed", "verified"]);
    expect(view.final).toBe(false);
  });

  it("takes the most cautious status for the whole receipt", () => {
    const mixed = [event({}), event({ kind: Kind.Click, eventId: TX(101), status: "rejected" })];
    expect(toReceiptView(receipt({}, mixed), CONTRACT).status.status).toBe("rejected");
    expect(toReceiptView(receipt(), CONTRACT).status.status).toBe("released");
    expect(toReceiptView(receipt(), CONTRACT).final).toBe(true);
  });

  it("links the contract and offers the verify command", () => {
    const view = toReceiptView(receipt(), CONTRACT);
    expect(view.contractUrl).toBe(`https://testnet.monadvision.com/address/${CONTRACT}`);
    expect(view.verifyCommand).toBe("pnpm --filter @aria-clearing/receipt verify req_fixture");
  });
});

describe("expectedFromQuery", () => {
  it("reads the card's sentence and claims hashes", () => {
    expect(expectedFromQuery({ h: TX(200), c: TX(400) })).toEqual({ rationaleHash: TX(200), claimsHash: TX(400) });
  });

  it("takes the first of repeated values", () => {
    expect(expectedFromQuery({ h: [TX(200), TX(201)] })).toEqual({ rationaleHash: TX(200) });
  });

  it("is undefined without hashes and drops malformed ones", () => {
    expect(expectedFromQuery({})).toBeUndefined();
    expect(expectedFromQuery({ h: "0x12", c: "nope" })).toBeUndefined();
    expect(expectedFromQuery({ h: "0x12", c: TX(400) })).toEqual({ claimsHash: TX(400) });
  });
});

describe("seen top line", () => {
  const seenView = (expected?: Parameters<typeof withExpected>[1], base: Receipt = receipt()) =>
    toReceiptView(withExpected(base, expected), CONTRACT);

  it("says the page was opened without the card's fingerprint when no hashes were given", () => {
    const view = seenView(undefined);

    expect(view.seen.state).toBe("absent");
    expect(view.seen.title).toBe("Opened without the card's fingerprint — showing what was logged.");
    expect(view.consistent).toBe(true);
  });

  it("confirms the sentence the reader saw when the card's hashes match", () => {
    const view = seenView({ rationaleHash: TX(200), claimsHash: TX(400) });

    expect(view.seen).toMatchObject({
      state: "match",
      title: "The sentence you saw matches the one logged on Monad",
      differences: [],
    });
    expect(view.ok).toBe(true);
  });

  it("speaks of the claims when only the claims hash was given", () => {
    expect(seenView({ claimsHash: TX(400) }).seen.title).toBe("The claims behind the card match the ones logged on Monad");
  });

  it("names the sentence fingerprint that differs", () => {
    const view = seenView({ rationaleHash: TX(999), claimsHash: TX(400) });

    expect(view.seen.state).toBe("mismatch");
    expect(view.seen.title).toBe("The sentence you saw does not match the one logged on Monad");
    expect(view.seen.differences).toEqual([
      { label: "Sentence fingerprint", card: "0x000000…0003e7", logged: "0x000000…0000c8" },
    ]);
    expect(view.ok).toBe(false);
    expect(view.consistent).toBe(true);
  });

  it("names the claims fingerprint when only the claims differ", () => {
    const view = seenView({ rationaleHash: TX(200), claimsHash: TX(999) });

    expect(view.seen.title).toBe("The card's claims do not match the ones logged on Monad");
    expect(view.seen.differences.map((d) => d.label)).toEqual(["Claims fingerprint"]);
  });

  it("does not confirm a matching fingerprint on an inconsistent record", () => {
    const view = seenView({ rationaleHash: TX(200) }, receipt({ ok: false, consistent: false }));

    expect(view.seen.state).toBe("mismatch");
    expect(view.seen.title).toBe("The logged record is not internally consistent");
  });

  it("renders the top line before the sentence and calls the hash checks internal consistency", () => {
    const html = renderToStaticMarkup(createElement(ReceiptDocument, { view: seenView({ rationaleHash: TX(200) }) }));

    expect(html.indexOf('data-seen="match"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-seen="match"')).toBeLessThan(html.indexOf("<blockquote"));
    expect(html).toContain("Logged record is internally consistent");
    expect(html).toContain("Internal consistency");
    expect(html).not.toContain("Hashes match the chain");
  });
});

describe("trustLine", () => {
  const stats = {
    address: "0x67435bD1FCd81D6c25C6546a86af0eF6887F72cb",
    impressions: 3,
    clicks: 0,
    pending: 0,
    disputed: 0,
    released: 3,
    rejected: 0,
    earned: 0n,
    trustScoreBps: 10_000,
    trustScore: 1,
    lastActivityAt: 0,
  } as const;

  it("reads the rate and settled count", () => {
    expect(trustLine(stats)).toBe("Publisher verification rate: 100% across 3 settled events · indexed by Envio");
    expect(trustLine({ ...stats, released: 1, trustScoreBps: 9_550 })).toBe(
      "Publisher verification rate: 95.5% across 1 settled event · indexed by Envio",
    );
  });

  it("is hidden without a score", () => {
    expect(trustLine(null)).toBeNull();
    expect(trustLine({ ...stats, trustScoreBps: null, trustScore: null })).toBeNull();
  });
});

describe("rejection reasons", () => {
  it("names the advertiser's dispute when a rejected event was disputed", () => {
    const view = toReceiptView(receipt({}, [event({ status: "rejected", disputedTx: TX(9) })]), CONTRACT);
    expect(view.status.note).toBe("Disputed by the advertiser, budget returned");
    expect(view.events[0].status.note).toBe("Disputed by the advertiser, budget returned");
  });

  it("says the evidence did not pass when a rejected event was not disputed", () => {
    const view = toReceiptView(receipt({}, [event({ status: "rejected" })]), CONTRACT);
    expect(view.status.note).toBe("Evidence did not pass verification, budget returned to the advertiser");
  });
});

describe("lifecycle summary", () => {
  it("ends on verified and paid for a released receipt", () => {
    expect(toReceiptView(receipt(), CONTRACT).lifecycleSummary).toBe("issued → logged → verified · paid");
  });

  it("ends on rejected for a rejected receipt", () => {
    const view = toReceiptView(receipt({}, [event({ status: "rejected" })]), CONTRACT);
    expect(view.lifecycleSummary).toBe("issued → logged → rejected");
  });

  it("shows the dispute before rejection", () => {
    const view = toReceiptView(receipt({}, [event({ status: "rejected", disputedTx: TX(9) })]), CONTRACT);
    expect(view.lifecycleSummary).toBe("issued → logged → disputed → rejected");
  });

  it("ends on awaiting verification while logged", () => {
    const view = toReceiptView(receipt({}, [event({ status: "logged", settledTx: undefined })]), CONTRACT);
    expect(view.lifecycleSummary).toBe("issued → logged → awaiting verification");
  });
});
