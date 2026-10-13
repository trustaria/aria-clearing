import { DISPUTE_FAILED, END_FAILED, type DisputeResult, type EndResult } from "../../../lib/advertise-client";

/** Seconds of dispute window a wallet-signed dispute needs: the wallet prompt and the transaction take time. */
export const WALLET_DISPUTE_MIN_S = 5;

/** sent: the dispute tx is mined; the verdict comes with the next settlement. */
export type DisputeState = { phase: "sending" } | { phase: "sent" } | { phase: "error"; message: string };

/** `refunded` is in cents. */
export type EndState =
  | { phase: "idle" }
  | { phase: "confirming" }
  | { phase: "sending" }
  | { phase: "ended"; refunded: number }
  | { phase: "error"; message: string };

/** What the advertiser has done on the page, ahead of the next stats poll. */
export type Actions = { disputes: Record<string, DisputeState>; end: EndState };

export type ActionEvent =
  | { type: "dispute-start"; eventId: string }
  | { type: "dispute-done"; eventId: string }
  | { type: "dispute-failed"; eventId: string; message: string }
  | { type: "end-ask" }
  | { type: "end-cancel" }
  | { type: "end-start" }
  | { type: "end-done"; refunded: number }
  | { type: "end-failed"; message: string };

export const NO_ACTIONS: Actions = { disputes: {}, end: { phase: "idle" } };

/** Applies one step of a dispute or of End. Pure. */
export function reduceActions(state: Actions, event: ActionEvent): Actions {
  switch (event.type) {
    case "dispute-start":
      return { ...state, disputes: { ...state.disputes, [event.eventId]: { phase: "sending" } } };
    case "dispute-done":
      return { ...state, disputes: { ...state.disputes, [event.eventId]: { phase: "sent" } } };
    case "dispute-failed":
      return { ...state, disputes: { ...state.disputes, [event.eventId]: { phase: "error", message: event.message } } };
    case "end-ask":
      return state.end.phase === "idle" || state.end.phase === "error" ? { ...state, end: { phase: "confirming" } } : state;
    case "end-cancel":
      return state.end.phase === "confirming" ? { ...state, end: { phase: "idle" } } : state;
    case "end-start":
      return { ...state, end: { phase: "sending" } };
    case "end-done":
      return { ...state, end: { phase: "ended", refunded: event.refunded } };
    case "end-failed":
      return { ...state, end: { phase: "error", message: event.message } };
  }
}

/** Disputes one event: optimistic "sending", then "sent" or the error copy. */
export async function runDispute(
  eventId: string,
  send: (eventId: string) => Promise<DisputeResult>,
  dispatch: (event: ActionEvent) => void,
): Promise<void> {
  dispatch({ type: "dispute-start", eventId });
  const result = await send(eventId).catch((): DisputeResult => ({ error: DISPUTE_FAILED }));
  dispatch("error" in result ? { type: "dispute-failed", eventId, message: result.error } : { type: "dispute-done", eventId });
}

/** Ends the campaign after confirmation: "sending", then "ended" with the refund or the error copy. */
export async function runEnd(send: () => Promise<EndResult>, dispatch: (event: ActionEvent) => void): Promise<void> {
  dispatch({ type: "end-start" });
  const result = await send().catch((): EndResult => ({ error: END_FAILED }));
  dispatch("error" in result ? { type: "end-failed", message: result.error } : { type: "end-done", refunded: result.refunded });
}

/** Disputes from the advertiser's wallet (`send` resolves once mined), then reports the transaction to the server. */
export async function walletDispute(
  eventId: string,
  deps: { send: (eventId: string) => Promise<string>; report: (eventId: string, txHash: string) => Promise<DisputeResult> },
): Promise<DisputeResult> {
  let txHash: string;
  try {
    txHash = await deps.send(eventId);
  } catch {
    return { error: DISPUTE_FAILED };
  }
  return deps.report(eventId, txHash);
}

/**
 * Ends a wallet-funded campaign: the server marks it ending, the advertiser's wallet withdraws (resolving once
 * mined), then the server checks the withdraw. When the wallet does not withdraw, the campaign goes back to live.
 */
export async function walletEnd(deps: {
  begin: () => Promise<{ campaignId: string } | { error: string }>;
  withdraw: (campaignId: string) => Promise<string>;
  finish: (txHash: string) => Promise<EndResult>;
  cancel: () => Promise<void>;
}): Promise<EndResult> {
  const started = await deps.begin();
  if ("error" in started) return started;
  let txHash: string;
  try {
    txHash = await deps.withdraw(started.campaignId);
  } catch {
    await deps.cancel().catch(() => undefined);
    return { error: END_FAILED };
  }
  return deps.finish(txHash);
}
