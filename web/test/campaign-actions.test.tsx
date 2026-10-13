import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NO_ACTIONS,
  reduceActions,
  runDispute,
  runEnd,
  walletDispute,
  walletEnd,
  WALLET_DISPUTE_MIN_S,
  type ActionEvent,
  type EndState,
} from "../components/advertise/campaign/actions";
import { EndCampaign, SentenceItem } from "../components/advertise/campaign/CampaignPanel";
import type { SentenceRow } from "../components/advertise/campaign/view-model";
import { createHttpClient, createMockClient, DISPUTE_FAILED, END_FAILED } from "../lib/advertise-client";

function recorder() {
  const events: ActionEvent[] = [];
  return { events, dispatch: (e: ActionEvent) => events.push(e), state: () => events.reduce(reduceActions, NO_ACTIONS) };
}

function json(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("dispute and end with a client", () => {
  it("disputes through the route and ends as sent", async () => {
    const fetchImpl = json(200, { txHash: "0xab" });
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    const r = recorder();
    await runDispute("0x01", (id) => client.dispute("crema-works-a1b2", id), r.dispatch);
    expect(r.events.map((e) => e.type)).toEqual(["dispute-start", "dispute-done"]);
    expect(r.state().disputes["0x01"]).toEqual({ phase: "sent" });
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/advertise/campaigns/crema-works-a1b2/dispute");
    expect(JSON.parse(init.body as string)).toEqual({ eventId: "0x01" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("shows the route's copy when the window has closed", async () => {
    const closed = "This one can't be disputed any more: the 20-second window has closed.";
    const client = createHttpClient(async () => "tok", json(409, { error: closed }) as unknown as typeof fetch);
    const r = recorder();
    await runDispute("0x01", (id) => client.dispute("s", id), r.dispatch);
    expect(r.state().disputes["0x01"]).toEqual({ phase: "error", message: closed });
  });

  it("falls back to the dispute failure copy when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    const r = recorder();
    await runDispute("0x01", (id) => client.dispute("s", id), r.dispatch);
    expect(r.state().disputes["0x01"]).toEqual({ phase: "error", message: DISPUTE_FAILED });
  });

  it("ends with the refunded cents", async () => {
    const fetchImpl = json(200, { refunded: 377, txHash: "0xab" });
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    const r = recorder();
    r.dispatch({ type: "end-ask" });
    await runEnd(() => client.endCampaign("crema-works-a1b2"), r.dispatch);
    expect(r.events.map((e) => e.type)).toEqual(["end-ask", "end-start", "end-done"]);
    expect(r.state().end).toEqual({ phase: "ended", refunded: 377 });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/api/advertise/campaigns/crema-works-a1b2/end");
  });

  it("shows the End failure copy", async () => {
    const client = createHttpClient(async () => "tok", json(502, {}) as unknown as typeof fetch);
    const r = recorder();
    await runEnd(() => client.endCampaign("s"), r.dispatch);
    expect(r.state().end).toEqual({ phase: "error", message: END_FAILED });
  });

  it("mock client ends a listed campaign", async () => {
    const client = createMockClient({
      delayMs: 0,
      campaigns: [{ slug: "a", advertiser: "A", status: "live", spent: 120, budget: 500, impressions: 0, clicks: 0 }],
    });
    await expect(client.endCampaign("a")).resolves.toMatchObject({ refunded: 380 });
    expect((await client.listCampaigns()).campaigns[0].status).toBe("ended");
  });
});

describe("EndCampaign", () => {
  const render = (state: EndState, onConfirm?: () => void) =>
    renderToStaticMarkup(
      <EndCampaign
        brand="Crema Works"
        remaining="$3.77"
        state={state}
        onAsk={() => {}}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

  it("offers End with the remaining amount", () => {
    const html = render({ phase: "idle" }, () => {});
    expect(html).toContain("End campaign");
    expect(html).toContain("Stops new ads and returns the remaining $3.77.");
  });

  it("asks inline with the spec copy", () => {
    const html = render({ phase: "confirming" }, () => {});
    expect(html).toContain(
      "End Crema Works? New ads stop now. $3.77 returns to your account. Ads already being verified settle normally.",
    );
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">End campaign</button>");
  });

  it("disables both buttons while ending", () => {
    const html = render({ phase: "sending" }, () => {});
    expect(html).toContain("Ending…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows the error inline", () => {
    const html = render({ phase: "error", message: END_FAILED }, () => {});
    expect(html.replace(/&#x27;/g, "'")).toContain(END_FAILED);
    expect(html).toContain('role="alert"');
  });

  it("is disabled without a handler", () => {
    expect(render({ phase: "idle" })).toContain('disabled=""');
  });
});

describe("wallet-signed dispute and end", () => {
  const EVENT = `0x${"0e".repeat(32)}`;
  const CAMPAIGN = `0x${"0c".repeat(32)}`;
  const TX = `0x${"cd".repeat(32)}`;

  it("sends the dispute from the wallet, then reports the transaction", async () => {
    const send = vi.fn(async () => TX);
    const report = vi.fn(async () => ({ txHash: TX }));
    const r = recorder();
    await runDispute(EVENT, (id) => walletDispute(id, { send, report }), r.dispatch);
    expect(send).toHaveBeenCalledWith(EVENT);
    expect(report).toHaveBeenCalledWith(EVENT, TX);
    expect(r.state().disputes[EVENT]).toEqual({ phase: "sent" });
  });

  it("shows the dispute failure copy when the wallet send fails", async () => {
    const report = vi.fn();
    const r = recorder();
    const send = vi.fn(async () => {
      throw new Error("User rejected");
    });
    await runDispute(EVENT, (id) => walletDispute(id, { send, report }), r.dispatch);
    expect(r.state().disputes[EVENT]).toEqual({ phase: "error", message: DISPUTE_FAILED });
    expect(report).not.toHaveBeenCalled();
  });

  it("marks ending, withdraws from the wallet, then reports the withdraw", async () => {
    const calls: string[] = [];
    const deps = {
      begin: vi.fn(async () => (calls.push("begin"), { campaignId: CAMPAIGN })),
      withdraw: vi.fn(async () => (calls.push("withdraw"), TX)),
      finish: vi.fn(async () => (calls.push("finish"), { refunded: 377, txHash: TX })),
      cancel: vi.fn(async () => void calls.push("cancel")),
    };
    const r = recorder();
    await runEnd(() => walletEnd(deps), r.dispatch);
    expect(calls).toEqual(["begin", "withdraw", "finish"]);
    expect(deps.withdraw).toHaveBeenCalledWith(CAMPAIGN);
    expect(deps.finish).toHaveBeenCalledWith(TX);
    expect(r.state().end).toEqual({ phase: "ended", refunded: 377 });
  });

  it("puts the campaign back to live when the wallet withdraw fails", async () => {
    const deps = {
      begin: vi.fn(async () => ({ campaignId: CAMPAIGN })),
      withdraw: vi.fn(async () => {
        throw new Error("User rejected");
      }),
      finish: vi.fn(),
      cancel: vi.fn(async () => {}),
    };
    expect(await walletEnd(deps)).toEqual({ error: END_FAILED });
    expect(deps.cancel).toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("stops before the wallet when the server refuses to start", async () => {
    const deps = { begin: vi.fn(async () => ({ error: "Nope." })), withdraw: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    expect(await walletEnd(deps)).toEqual({ error: "Nope." });
    expect(deps.withdraw).not.toHaveBeenCalled();
  });

  it("posts the wallet dispute and end steps to the routes", async () => {
    const replies = [{ txHash: TX }, { ending: true, campaignId: CAMPAIGN }, { refunded: 377, txHash: TX }, { status: "live" }];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 }));
    const client = createHttpClient(async () => "tok", fetchImpl as unknown as typeof fetch);
    expect(await client.dispute("s", EVENT, TX)).toEqual({ txHash: TX });
    expect(await client.beginWalletEnd("s")).toEqual({ campaignId: CAMPAIGN });
    expect(await client.finishWalletEnd("s", TX)).toEqual({ refunded: 377, txHash: TX });
    await client.cancelWalletEnd("s");
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([path, init]) => [path, JSON.parse(init.body as string)])).toEqual([
      ["/api/advertise/campaigns/s/dispute", { eventId: EVENT, txHash: TX }],
      ["/api/advertise/campaigns/s/end", {}],
      ["/api/advertise/campaigns/s/end", { txHash: TX }],
      ["/api/advertise/campaigns/s/end", { cancel: true }],
    ]);
  });
});

describe("dispute button", () => {
  const row = (disputeSecondsLeft: number): SentenceRow => ({
    eventId: `0x${"0e".repeat(32)}`,
    quote: "Crema Works makes compact espresso machines.",
    meta: "Impression · being verified · $0.01 · 3 s ago",
    tone: "pending",
    receiptUrl: "/receipt/r1",
    disputeSecondsLeft,
    dispute: null,
  });
  const button = (left: number, minLeft?: number) =>
    renderToStaticMarkup(
      <ul>
        <SentenceItem row={row(left)} elapsed={0} onDispute={() => {}} minLeft={minLeft} />
      </ul>,
    );

  it("stays enabled to the end of the window for treasury-funded campaigns", () => {
    expect(button(3)).toMatch(/<button[^>]*class="[^"]*">Dispute \(3 s\)/);
  });

  it("disables Dispute when fewer than 5 seconds remain for a wallet-funded campaign", () => {
    expect(button(3, WALLET_DISPUTE_MIN_S)).toMatch(/<button[^>]*disabled=""[^>]*>Dispute \(3 s\)/);
    expect(button(5, WALLET_DISPUTE_MIN_S)).not.toContain('disabled=""');
    expect(WALLET_DISPUTE_MIN_S).toBe(5);
  });
});
