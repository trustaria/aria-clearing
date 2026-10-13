import type { Address, Hex } from "viem";
import type { Advertiser } from "../../../../../lib/advertiser-auth";
import { disputeMismatch, withdrawnBy, type WalletReceipt } from "../../../../../lib/campaign-confirm";
import { fundingOf, type StoredCampaign } from "../../../../../lib/campaign-store";
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
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export type ActionDeps = {
  auth: (req: Request) => Promise<Advertiser | Response>;
  getRecord: (slug: string) => StoredCampaign | undefined;
  update: (slug: string, patch: Partial<StoredCampaign>) => StoredCampaign;
  dispute: (campaignId: Hex, eventId: Hex) => Promise<{ txHash: Hex }>;
  /** `amount` is the withdrawn USDC, 6 decimals. */
  withdraw: (campaignId: Hex) => Promise<{ amount: bigint; txHash: Hex }>;
  /** The owner's embedded wallet, looked up server-side. Needed for wallet-funded campaigns. */
  walletOf?: (userId: string) => Promise<Address | null>;
  /** Waits for a transaction the advertiser's wallet sent. */
  walletReceipt?: (hash: Hex) => Promise<WalletReceipt>;
  /** The campaign id an event belongs to onchain. */
  eventCampaign?: (eventId: Hex) => Promise<Hex>;
  clearing?: () => Address;
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

/**
 * Dispute and End for one of the signed-in advertiser's campaigns; any other slug is "not found".
 * Treasury-funded campaigns are signed by the server. For wallet-funded ones the advertiser's wallet signs and the
 * server checks the mined transaction: dispute takes `{eventId, txHash}`; End takes `{}` (marks it ending),
 * `{txHash}` (the withdraw) or `{cancel: true}` (back to live while ending).
 */
export function createCampaignActions(deps: ActionDeps) {
  async function owned(req: Request, slug: string): Promise<StoredCampaign | Response> {
    const advertiser = await deps.auth(req);
    if (advertiser instanceof Response) return advertiser;
    const record = deps.getRecord(slug);
    if (!record || record.ownerId !== advertiser.userId) return json(404, { error: CAMPAIGN_NOT_FOUND });
    return record;
  }

  /** The owner's wallet, the mined wallet transaction and the clearing address, or the error response. */
  async function walletTx(
    record: StoredCampaign,
    txHash: Hex,
    failure: string,
  ): Promise<[Address, WalletReceipt, Address] | Response> {
    if (!deps.walletOf || !deps.walletReceipt || !deps.clearing) return json(502, { error: failure });
    try {
      const wallet = await deps.walletOf(record.ownerId);
      if (!wallet) return json(502, { error: failure });
      return [wallet, await deps.walletReceipt(txHash), deps.clearing()];
    } catch (err) {
      console.error(`advertise wallet tx ${txHash} for ${record.slug} unreadable: ${message(err)}`);
      return json(502, { error: failure });
    }
  }

  async function walletDispute(record: StoredCampaign, eventId: Hex, txHash: unknown): Promise<Response> {
    if (typeof txHash !== "string" || !TX_HASH.test(txHash)) return json(400, { error: DISPUTE_FAILED });
    const hash = txHash.toLowerCase() as Hex;
    if (record.disputes?.[eventId]?.toLowerCase() === hash) return json(200, { txHash: hash });

    const sent = await walletTx(record, hash, DISPUTE_FAILED);
    if (sent instanceof Response) return sent;
    const [wallet, receipt, clearing] = sent;
    const problem = disputeMismatch(receipt, clearing, wallet, eventId);
    if (problem) {
      console.warn(`advertise dispute refused for ${record.slug} (tx ${hash}): ${problem}`);
      return json(422, { error: DISPUTE_FAILED });
    }
    try {
      const campaignId = await deps.eventCampaign?.(eventId);
      if (campaignId?.toLowerCase() !== record.campaignId.toLowerCase()) return json(404, { error: EVENT_NOT_FOUND });
    } catch (err) {
      console.error(`advertise dispute: event ${eventId} unreadable: ${message(err)}`);
      return json(502, { error: DISPUTE_FAILED });
    }
    deps.update(record.slug, { disputes: { ...record.disputes, [eventId]: hash } });
    return json(200, { txHash: hash });
  }

  async function walletEnd(record: StoredCampaign, body: { txHash?: unknown; cancel?: unknown } | null): Promise<Response> {
    if (body?.cancel === true) {
      if (record.status === "ending") deps.update(record.slug, { status: "live" });
      return json(200, { status: record.status === "ending" ? "live" : record.status });
    }
    if (body?.txHash === undefined) {
      if (record.status === "live") deps.update(record.slug, { status: "ending" });
      return json(200, { ending: true, campaignId: record.campaignId });
    }
    if (typeof body.txHash !== "string" || !TX_HASH.test(body.txHash)) return json(400, { error: END_FAILED });
    const hash = body.txHash.toLowerCase() as Hex;

    const sent = await walletTx(record, hash, END_FAILED);
    if (sent instanceof Response) return sent;
    const [wallet, receipt, clearing] = sent;
    const withdrawn = withdrawnBy(receipt, clearing, wallet, record.campaignId);
    if ("error" in withdrawn) {
      console.warn(`advertise end refused for ${record.slug} (tx ${hash}): ${withdrawn.error}`);
      return json(422, { error: END_FAILED });
    }
    deps.update(record.slug, { status: "ended", refunded: Number(withdrawn.amount), endTxHash: hash });
    return json(200, { refunded: Number(withdrawn.amount / UNITS_PER_CENT), txHash: hash });
  }

  return {
    /** `{eventId}` → `{txHash}` once the dispute tx is mined. */
    async dispute(req: Request, slug: string): Promise<Response> {
      const record = await owned(req, slug);
      if (record instanceof Response) return record;

      const body = (await req.json().catch(() => null)) as { eventId?: unknown; txHash?: unknown } | null;
      const eventId = body?.eventId;
      if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) return json(404, { error: EVENT_NOT_FOUND });
      if (fundingOf(record) === "wallet") return walletDispute(record, eventId.toLowerCase() as Hex, body?.txHash);

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
      if (fundingOf(record) === "wallet") {
        return walletEnd(record, (await req.json().catch(() => null)) as { txHash?: unknown; cancel?: unknown } | null);
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
