import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NO_ACTIONS,
  reduceActions,
  runDispute,
  runEnd,
  type ActionEvent,
  type EndState,
} from "../components/advertise/campaign/actions";
import { EndCampaign } from "../components/advertise/campaign/CampaignPanel";
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
