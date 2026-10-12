import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hex } from "viem";

export type EventKind = "impression" | "click";

export type EventStatus = "queued" | "logged" | "failed";

/** What the publisher saw: the facts the settlement workflow judges. */
export type Evidence = {
  viewMs: number;
  visibleRatio: number;
  clickRedirected: boolean;
  firstSeenAt: string;
};

/** One impression or click, keyed by its onchain eventId. */
export type EventRecord = {
  eventId: Hex;
  requestId: string;
  kind: EventKind;
  campaignId: Hex;
  publisher: Hex;
  evidence: Evidence;
  forged: boolean;
  status: EventStatus;
  txHash?: Hex;
  error?: string;
  createdAt: number;
  loggedAt?: number;
  disputeTxHash?: Hex;
};

/** A card the server handed out, keyed by requestId. */
export type ServedPick = {
  requestId: string;
  slug: string;
  campaignId: Hex;
  rationale: string;
  claimRefs: number[];
  servedAt: number;
};

type Snapshot = {
  events: Record<string, EventRecord>;
  served: Record<string, ServedPick>;
};

export type EventStore = {
  getEvent(eventId: string): EventRecord | undefined;
  listEvents(): EventRecord[];
  /** Inserts the record unless a non-failed one exists for its eventId; returns whichever is stored. */
  claimEvent(record: EventRecord): { record: EventRecord; created: boolean };
  updateEvent(eventId: string, patch: Partial<EventRecord>): EventRecord;
  putServed(pick: ServedPick): void;
  getServed(requestId: string): ServedPick | undefined;
  listServed(): ServedPick[];
};

function load(file: string): Snapshot {
  if (!existsSync(file)) return { events: {}, served: {} };
  const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Snapshot>;
  return { events: saved.events ?? {}, served: saved.served ?? {} };
}

/** Events and served picks in memory, written through to a JSON file on every change. */
export function createEventStore(file: string): EventStore {
  const data = load(file);

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };

  return {
    getEvent(eventId) {
      return data.events[eventId.toLowerCase()];
    },
    listEvents() {
      return Object.values(data.events).sort((a, b) => a.createdAt - b.createdAt);
    },
    claimEvent(record) {
      const key = record.eventId.toLowerCase();
      const existing = data.events[key];
      if (existing && existing.status !== "failed") return { record: existing, created: false };
      data.events[key] = { ...record, eventId: key as Hex };
      save();
      return { record: data.events[key], created: true };
    },
    updateEvent(eventId, patch) {
      const key = eventId.toLowerCase();
      const existing = data.events[key];
      if (!existing) throw new Error(`Unknown event ${eventId}`);
      data.events[key] = { ...existing, ...patch, eventId: existing.eventId };
      save();
      return data.events[key];
    },
    putServed(pick) {
      data.served[pick.requestId] = pick;
      save();
    },
    getServed(requestId) {
      return data.served[requestId];
    },
    listServed() {
      return Object.values(data.served).sort((a, b) => a.servedAt - b.servedAt);
    },
  };
}

// One store per file on globalThis, so every route bundle (and dev reloads) share it.
const globalStores = globalThis as typeof globalThis & { __ariaEventStores?: Map<string, EventStore> };
const stores = (globalStores.__ariaEventStores ??= new Map<string, EventStore>());

/** The app's store: ARIA_EVENTS_FILE, else `.data/events.json` under the web app. */
export function eventStore(): EventStore {
  const file = process.env.ARIA_EVENTS_FILE ?? join(process.cwd(), ".data", "events.json");
  let store = stores.get(file);
  if (!store) {
    store = createEventStore(file);
    stores.set(file, store);
  }
  return store;
}
