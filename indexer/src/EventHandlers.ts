import { indexer, type ClearingEvent, type Protocol, type Publisher } from "envio";
import { STATUS_REJECTED, STATUS_RELEASED, emptyPublisher, moveEvent, type Bucket } from "./publisher.js";

const BUCKET: Record<ClearingEvent["status"], Bucket> = {
  logged: "pending",
  disputed: "disputed",
  released: "released",
  rejected: "rejected",
};

async function loadPublisher(
  context: { Publisher: { get: (id: string) => Promise<Publisher | undefined> } },
  id: string,
): Promise<Publisher> {
  return (await context.Publisher.get(id)) ?? emptyPublisher(id);
}

const PROTOCOL_ID = "aria";

async function loadProtocol(context: { Protocol: { get: (id: string) => Promise<Protocol | undefined> } }): Promise<Protocol> {
  return (await context.Protocol.get(PROTOCOL_ID)) ?? { id: PROTOCOL_ID, feesAccrued: 0n, feesWithdrawn: 0n };
}

indexer.onEvent({ contract: "AriaClearing", event: "CampaignCreated" }, async ({ event, context }) => {
  const p = event.params;
  context.Campaign.set({
    id: p.campaignId,
    advertiser: p.advertiser,
    claimsHash: p.claimsHash,
    priceImpression: p.priceImpression,
    priceClick: p.priceClick,
    budget: p.budget,
    spent: 0n,
    refunded: 0n,
    withdrawn: 0n,
  });
});

indexer.onEvent({ contract: "AriaClearing", event: "EventLogged" }, async ({ event, context }) => {
  const p = event.params;
  if (await context.ClearingEvent.get(p.eventId)) return;
  const at = event.block.timestamp;
  const isClick = p.kind === 1n;

  context.ClearingEvent.set({
    id: p.eventId,
    requestId: p.requestId,
    campaign_id: p.campaignId,
    publisher_id: p.publisher,
    kind: isClick ? "click" : "impression",
    rationale: p.rationale,
    price: p.price,
    status: "logged",
    wasDisputed: false,
    paid: false,
    fee: undefined,
    loggedAt: at,
    loggedTx: event.transaction.hash,
    settledAt: undefined,
    settledTx: undefined,
    paidTx: undefined,
  });

  const pub = moveEvent(await loadPublisher(context, p.publisher), undefined, "pending", at);
  context.Publisher.set({
    ...pub,
    impressions: pub.impressions + (isClick ? 0 : 1),
    clicks: pub.clicks + (isClick ? 1 : 0),
  });
});

indexer.onEvent({ contract: "AriaClearing", event: "EventDisputed" }, async ({ event, context }) => {
  const ev = await context.ClearingEvent.get(event.params.eventId);
  if (!ev || ev.status !== "logged") return;
  const at = event.block.timestamp;

  context.ClearingEvent.set({ ...ev, status: "disputed", wasDisputed: true });
  const pub = await loadPublisher(context, ev.publisher_id);
  context.Publisher.set(moveEvent(pub, "pending", "disputed", at));
});

indexer.onEvent({ contract: "AriaClearing", event: "EventSettled" }, async ({ event, context }) => {
  const ev = await context.ClearingEvent.get(event.params.eventId);
  if (!ev || ev.status === "released" || ev.status === "rejected") return;
  const outcome = event.params.outcome;
  if (outcome !== STATUS_RELEASED && outcome !== STATUS_REJECTED) return;
  const status = outcome === STATUS_RELEASED ? "released" : "rejected";
  const at = event.block.timestamp;

  context.ClearingEvent.set({ ...ev, status, settledAt: at, settledTx: event.transaction.hash });

  const pub = await loadPublisher(context, ev.publisher_id);
  context.Publisher.set(moveEvent(pub, BUCKET[ev.status], status, at));

  const campaign = await context.Campaign.get(ev.campaign_id);
  if (campaign) {
    context.Campaign.set(
      status === "released"
        ? { ...campaign, spent: campaign.spent + ev.price }
        : { ...campaign, refunded: campaign.refunded + ev.price },
    );
  }
});

indexer.onEvent({ contract: "AriaClearing", event: "PaidOut" }, async ({ event, context }) => {
  const p = event.params;
  const at = event.block.timestamp;
  const ev = await context.ClearingEvent.get(p.eventId);
  if (ev?.paid) return;
  if (ev) context.ClearingEvent.set({ ...ev, paid: true, paidTx: event.transaction.hash, fee: p.fee });
  if (ev?.fee === undefined) {
    const protocol = await loadProtocol(context);
    context.Protocol.set({ ...protocol, feesAccrued: protocol.feesAccrued + p.fee });
  }

  const pub = await loadPublisher(context, p.publisher);
  context.Publisher.set({
    ...pub,
    earned: pub.earned + p.amount,
    lastActivityAt: Math.max(pub.lastActivityAt, at),
  });
});

indexer.onEvent({ contract: "AriaClearing", event: "PayoutDeferred" }, async ({ event, context }) => {
  // The net amount becomes claimable credit; `Claimed` adds it to `earned` when transferred.
  const p = event.params;
  const ev = await context.ClearingEvent.get(p.eventId);
  if (ev?.fee !== undefined) return;
  if (ev) context.ClearingEvent.set({ ...ev, fee: p.fee });
  const protocol = await loadProtocol(context);
  context.Protocol.set({ ...protocol, feesAccrued: protocol.feesAccrued + p.fee });

  const pub = await loadPublisher(context, p.publisher);
  context.Publisher.set({ ...pub, lastActivityAt: Math.max(pub.lastActivityAt, event.block.timestamp) });
});

indexer.onEvent({ contract: "AriaClearing", event: "Claimed" }, async ({ event, context }) => {
  const p = event.params;
  const pub = await loadPublisher(context, p.publisher);
  context.Publisher.set({
    ...pub,
    earned: pub.earned + p.amount,
    lastActivityAt: Math.max(pub.lastActivityAt, event.block.timestamp),
  });
});

indexer.onEvent({ contract: "AriaClearing", event: "Withdrawn" }, async ({ event, context }) => {
  const campaign = await context.Campaign.get(event.params.campaignId);
  if (campaign) context.Campaign.set({ ...campaign, withdrawn: campaign.withdrawn + event.params.amount });
});

indexer.onEvent({ contract: "AriaClearing", event: "FeesWithdrawn" }, async ({ event, context }) => {
  const protocol = await loadProtocol(context);
  context.Protocol.set({ ...protocol, feesWithdrawn: protocol.feesWithdrawn + event.params.amount });
});
