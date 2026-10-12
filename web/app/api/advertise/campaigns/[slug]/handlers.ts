import type { Hex } from "viem";
import type { Advertiser } from "../../../../../lib/advertiser-auth";
import type { StoredCampaign } from "../../../../../lib/campaign-store";
import { TreasuryError } from "../../../../../lib/treasury";

/** USDC units (6 decimals) per US cent. */
const UNITS_PER_CENT = 10_000n;

export const CAMPAIGN_NOT_FOUND = "Campaign not found.";
export const EVENT_NOT_FOUND = "We couldn't find that ad in this campaign.";
export const WINDOW_CLOSED = "This one can't be disputed any more: the 20-second window has closed.";
export const ALREADY_DISPUTED = "This one is already disputed.";
export const DISPUTE_FAILED = "We couldn't dispute this one right now. Try again in a few seconds.";
export const END_FAILED = "We couldn't end your campaign right now. Nothing changed. Try again in a minute.";
export const END_IN_PROGRESS = "Your campaign is already ending.";

const EVENT_ID = /^0x[0-9a-fA-F]{64}$/;

export type ActionDeps = {
  auth: (req: Request) => Promise<Advertiser | Response>;
  getRecord: (slug: string) => StoredCampaign | undefined;
  update: (slug: string, patch: Partial<StoredCampaign>) => StoredCampaign;
  dispute: (campaignId: Hex, eventId: Hex) => Promise<{ txHash: Hex }>;
  /** `amount` is the withdrawn USDC, 6 decimals. */
  withdraw: (campaignId: Hex) => Promise<{ amount: bigint; txHash: Hex }>;
};

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DISPUTE_REFUSALS: Partial<Record<TreasuryError["code"], [number, string]>> = {
  "not-found": [404, EVENT_NOT_FOUND],
  "window-closed": [409, WINDOW_CLOSED],
  "already-disputed": [409, ALREADY_DISPUTED],
};

/** Dispute and End for one of the signed-in advertiser's campaigns; any other slug is "not found". */
export function createCampaignActions(deps: ActionDeps) {
  async function owned(req: Request, slug: string): Promise<StoredCampaign | Response> {
    const advertiser = await deps.auth(req);
    if (advertiser instanceof Response) return advertiser;
    const record = deps.getRecord(slug);
    if (!record || record.ownerId !== advertiser.userId) return json(404, { error: CAMPAIGN_NOT_FOUND });
    return record;
  }

  return {
    /** `{eventId}` → `{txHash}` once the dispute tx is mined. */
    async dispute(req: Request, slug: string): Promise<Response> {
      const record = await owned(req, slug);
      if (record instanceof Response) return record;

      const body = (await req.json().catch(() => null)) as { eventId?: unknown } | null;
      const eventId = body?.eventId;
      if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) return json(404, { error: EVENT_NOT_FOUND });

      try {
        const { txHash } = await deps.dispute(record.campaignId, eventId as Hex);
        return json(200, { txHash });
      } catch (err) {
        const refusal = err instanceof TreasuryError ? DISPUTE_REFUSALS[err.code] : undefined;
        if (refusal) return json(refusal[0], { error: refusal[1] });
        if (!(err instanceof TreasuryError)) console.error(`advertise dispute failed for ${slug}: ${message(err)}`);
        return json(502, { error: DISPUTE_FAILED });
      }
    },

    /** Marks the campaign "ending" (it leaves the pick list), withdraws, then saves it as "ended". `refunded` is in cents. */
    async end(req: Request, slug: string): Promise<Response> {
      const record = await owned(req, slug);
      if (record instanceof Response) return record;
      if (record.status === "ended") {
        return json(200, { refunded: Number(BigInt(record.refunded ?? 0) / UNITS_PER_CENT), txHash: record.endTxHash });
      }
      if (record.status === "ending") return json(409, { error: END_IN_PROGRESS });

      deps.update(slug, { status: "ending" });
      let result: { amount: bigint; txHash: Hex };
      try {
        result = await deps.withdraw(record.campaignId);
      } catch (err) {
        if (!(err instanceof TreasuryError)) console.error(`advertise end failed for ${slug}: ${message(err)}`);
        deps.update(slug, { status: "live" });
        return json(502, { error: END_FAILED });
      }
      // The withdraw is final from here, so a failed write is logged and the End still succeeds.
      try {
        deps.update(slug, { status: "ended", refunded: Number(result.amount), endTxHash: result.txHash });
      } catch (err) {
        console.error(`advertise end save failed for ${slug} (tx ${result.txHash}, ${result.amount}): ${message(err)}`);
      }
      return json(200, { refunded: Number(result.amount / UNITS_PER_CENT), txHash: result.txHash });
    },
  };
}
