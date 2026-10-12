import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { campaignIdOf } from "@aria-clearing/receipt";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALREADY_DISPUTED,
  createCampaignActions,
  DISPUTE_FAILED,
  END_FAILED,
  END_IN_PROGRESS,
  EVENT_NOT_FOUND,
  WINDOW_CLOSED,
  type ActionDeps,
} from "../app/api/advertise/campaigns/[slug]/handlers";
import { createCampaignStore, type StoredCampaign } from "../lib/campaign-store";
import { TreasuryError } from "../lib/treasury";

const SLUG = "crema-works-a1b2";
const CAMPAIGN = campaignIdOf(SLUG);
const EVENT = `0x${"0e".repeat(32)}` as Hex;
const TX = `0x${"ab".repeat(32)}` as Hex;

function crema(): StoredCampaign {
  return {
    slug: SLUG,
    advertiser: "Crema Works",
    url: "https://crema.works",
    category: "food and drink",
    claims: ["Compact espresso machines for kitchens."],
    priceImpression: 10_000,
    priceClick: 250_000,
    budget: 5_000_000,
    keywords: [],
    campaignId: CAMPAIGN,
    ownerId: "did:privy:ana",
    ownerEmail: "ana@crema.works",
    txHash: "0xabc",
    createdBlock: 1234,
    createdAt: 1,
    status: "live",
  };
}

// Valid tokens are "token-<userId>".
async function auth(req: Request) {
  const token = /^Bearer token-(.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  return token ? { userId: token } : Response.json({ error: "Sign in to continue." }, { status: 401 });
}

function request(body?: unknown, user: string | null = "did:privy:ana") {
  return new Request(`http://localhost/api/advertise/campaigns/${SLUG}/x`, {
    method: "POST",
    headers: user ? { authorization: `Bearer token-${user}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("campaign actions", () => {
  let dir: string;
  let store: ReturnType<typeof createCampaignStore>;
  let deps: ActionDeps;
  let actions: ReturnType<typeof createCampaignActions>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aria-actions-"));
    store = createCampaignStore(join(dir, "campaigns.json"));
    store.saveCampaign(crema());
    deps = {
      auth,
      getRecord: (slug) => store.getStoredCampaign(slug),
      update: (slug, patch) => store.updateCampaign(slug, patch),
      dispute: vi.fn(async () => ({ txHash: TX })),
      withdraw: vi.fn(async () => ({ amount: 3_770_000n, txHash: TX })),
    };
    actions = createCampaignActions(deps);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("POST …/dispute", () => {
    it("disputes the owner's event and answers with the tx", async () => {
      const res = await actions.dispute(request({ eventId: EVENT }), SLUG);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ txHash: TX });
      expect(deps.dispute).toHaveBeenCalledWith(CAMPAIGN, EVENT);
    });

    it("needs a signed-in advertiser", async () => {
      const res = await actions.dispute(request({ eventId: EVENT }, null), SLUG);
      expect(res.status).toBe(401);
      expect(deps.dispute).not.toHaveBeenCalled();
    });

    it("answers 404 to another user and to an unknown slug", async () => {
      const other = await actions.dispute(request({ eventId: EVENT }, "did:privy:bo"), SLUG);
      expect(other.status).toBe(404);
      expect(await other.json()).toEqual({ error: "Campaign not found." });
      const unknown = await actions.dispute(request({ eventId: EVENT }), "nope-0000");
      expect(unknown.status).toBe(404);
      expect(deps.dispute).not.toHaveBeenCalled();
    });

    it("rejects a malformed event id", async () => {
      const res = await actions.dispute(request({ eventId: "0x12" }), SLUG);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: EVENT_NOT_FOUND });
      expect(deps.dispute).not.toHaveBeenCalled();
    });

    it("maps treasury refusals to their copy", async () => {
      const cases: [TreasuryError["code"], number, string][] = [
        ["not-found", 404, EVENT_NOT_FOUND],
        ["window-closed", 409, WINDOW_CLOSED],
        ["already-disputed", 409, ALREADY_DISPUTED],
        ["failed", 502, DISPUTE_FAILED],
      ];
      for (const [code, status, error] of cases) {
        vi.mocked(deps.dispute).mockRejectedValueOnce(new TreasuryError(code, code));
        const res = await actions.dispute(request({ eventId: EVENT }), SLUG);
        expect(res.status).toBe(status);
        expect(await res.json()).toEqual({ error });
      }
    });

    it("uses the spec copy for a closed window", () => {
      expect(WINDOW_CLOSED).toBe("This one can't be disputed any more: the 20-second window has closed.");
    });
  });

  describe("POST …/end", () => {
    it("withdraws, then saves the campaign as ended with the refunded amount", async () => {
      const statuses: string[] = [];
      vi.mocked(deps.withdraw).mockImplementationOnce(async () => {
        statuses.push(store.getStoredCampaign(SLUG)!.status);
        return { amount: 3_770_000n, txHash: TX };
      });
      const res = await actions.end(request(), SLUG);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ refunded: 377, txHash: TX });
      expect(statuses).toEqual(["ending"]);
      expect(deps.withdraw).toHaveBeenCalledWith(CAMPAIGN);
      expect(store.getStoredCampaign(SLUG)).toMatchObject({ status: "ended", refunded: 3_770_000, endTxHash: TX });
    });

    it("records a zero refund", async () => {
      vi.mocked(deps.withdraw).mockResolvedValueOnce({ amount: 0n, txHash: TX });
      const res = await actions.end(request(), SLUG);
      expect(await res.json()).toEqual({ refunded: 0, txHash: TX });
      expect(store.getStoredCampaign(SLUG)).toMatchObject({ status: "ended", refunded: 0 });
    });

    it("needs a signed-in owner", async () => {
      expect((await actions.end(request(undefined, null), SLUG)).status).toBe(401);
      const other = await actions.end(request(undefined, "did:privy:bo"), SLUG);
      expect(other.status).toBe(404);
      expect(await other.json()).toEqual({ error: "Campaign not found." });
      expect(deps.withdraw).not.toHaveBeenCalled();
      expect(store.getStoredCampaign(SLUG)!.status).toBe("live");
    });

    it("restores live and answers the failure copy when the send fails", async () => {
      vi.mocked(deps.withdraw).mockRejectedValueOnce(new TreasuryError("failed", "policy"));
      const res = await actions.end(request(), SLUG);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: END_FAILED });
      expect(store.getStoredCampaign(SLUG)!.status).toBe("live");
    });

    it("refuses a second End while the first is sending", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      vi.mocked(deps.withdraw).mockImplementationOnce(async () => {
        await gate;
        return { amount: 1n, txHash: TX };
      });
      const first = actions.end(request(), SLUG);
      await vi.waitFor(() => expect(store.getStoredCampaign(SLUG)!.status).toBe("ending"));
      const second = await actions.end(request(), SLUG);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: END_IN_PROGRESS });
      release();
      expect((await first).status).toBe(200);
      expect(deps.withdraw).toHaveBeenCalledTimes(1);
    });

    it("answers an ended campaign with its stored refund", async () => {
      store.updateCampaign(SLUG, { status: "ended", refunded: 1_230_000, endTxHash: TX });
      const res = await actions.end(request(), SLUG);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ refunded: 123, txHash: TX });
      expect(deps.withdraw).not.toHaveBeenCalled();
    });
  });
});
