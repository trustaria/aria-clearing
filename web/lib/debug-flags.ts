import { useSyncExternalStore } from "react";

// Client-side demo switch: while held, cards do not measure or report impressions.
let holdViews = false;
const listeners = new Set<() => void>();

export function setHoldViews(value: boolean): void {
  holdViews = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHoldViews(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holdViews,
    () => false,
  );
}
