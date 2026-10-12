import { eventStore, type ServedPick } from "./store";

export type { ServedPick };

export function rememberServed(pick: ServedPick): void {
  eventStore().putServed(pick);
}

export function getServed(requestId: string): ServedPick | undefined {
  return eventStore().getServed(requestId);
}

export function listServed(): ServedPick[] {
  return eventStore().listServed();
}
