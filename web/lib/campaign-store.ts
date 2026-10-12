import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hex } from "viem";
import type { Campaign } from "./campaigns";

/** live: pickable. ending: withdraw sent, no longer pickable. ended: withdrawn. */
export type CampaignStatus = "live" | "ending" | "ended";

/** A campaign launched from the advertiser console. Amounts are USDC with 6 decimals. */
export type StoredCampaign = Campaign & {
  priceImpression: number;
  priceClick: number;
  budget: number;
  keywords: string[];
  /** keccak256 of the slug, as onchain. */
  campaignId: Hex;
  /** Privy user id from the verified access token. */
  ownerId: string;
  /** Display only. */
  ownerEmail: string;
  /** The createCampaign transaction. */
  txHash: Hex;
  createdBlock: number;
  /** Unix ms. */
  createdAt: number;
  status: CampaignStatus;
  /** Withdrawn amount once ended. */
  refunded?: number;
  /** The withdraw transaction. */
  endTxHash?: Hex;
};

type Snapshot = { campaigns: Record<string, StoredCampaign> };

export type CampaignStore = {
  /** All records, oldest first. */
  listStoredCampaigns(): StoredCampaign[];
  getStoredCampaign(slug: string): StoredCampaign | undefined;
  /** Inserts the record, replacing any record with the same slug. */
  saveCampaign(record: StoredCampaign): StoredCampaign;
  /** Merges the patch into the record; the slug never changes. Throws on an unknown slug. */
  updateCampaign(slug: string, patch: Partial<StoredCampaign>): StoredCampaign;
  /** The owner's records, newest first. */
  listCampaignsByOwner(ownerId: string): StoredCampaign[];
};

function load(file: string): Snapshot {
  if (!existsSync(file)) return { campaigns: {} };
  const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Snapshot>;
  return { campaigns: saved.campaigns ?? {} };
}

/** Console campaigns in memory, written through to a JSON file on every change. */
export function createCampaignStore(file: string): CampaignStore {
  const data = load(file);

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };

  const all = () => Object.values(data.campaigns).sort((a, b) => a.createdAt - b.createdAt);

  return {
    listStoredCampaigns: all,
    getStoredCampaign(slug) {
      return data.campaigns[slug];
    },
    saveCampaign(record) {
      data.campaigns[record.slug] = record;
      save();
      return record;
    },
    updateCampaign(slug, patch) {
      const existing = data.campaigns[slug];
      if (!existing) throw new Error(`Unknown campaign ${slug}`);
      data.campaigns[slug] = { ...existing, ...patch, slug };
      save();
      return data.campaigns[slug];
    },
    listCampaignsByOwner(ownerId) {
      return all()
        .filter((c) => c.ownerId === ownerId)
        .reverse();
    },
  };
}

// One store per file on globalThis, so every route bundle (and dev reloads) share it.
const globalStores = globalThis as typeof globalThis & { __ariaCampaignStores?: Map<string, CampaignStore> };
const stores = (globalStores.__ariaCampaignStores ??= new Map<string, CampaignStore>());

/** The app's store: ARIA_CAMPAIGNS_FILE, else `.data/campaigns.json` under the web app. */
export function campaignStore(): CampaignStore {
  const file = process.env.ARIA_CAMPAIGNS_FILE ?? join(process.cwd(), ".data", "campaigns.json");
  let store = stores.get(file);
  if (!store) {
    store = createCampaignStore(file);
    stores.set(file, store);
  }
  return store;
}

export function listStoredCampaigns(): StoredCampaign[] {
  return campaignStore().listStoredCampaigns();
}

export function getStoredCampaign(slug: string): StoredCampaign | undefined {
  return campaignStore().getStoredCampaign(slug);
}

export function saveCampaign(record: StoredCampaign): StoredCampaign {
  return campaignStore().saveCampaign(record);
}

export function updateCampaign(slug: string, patch: Partial<StoredCampaign>): StoredCampaign {
  return campaignStore().updateCampaign(slug, patch);
}

export function listCampaignsByOwner(ownerId: string): StoredCampaign[] {
  return campaignStore().listCampaignsByOwner(ownerId);
}
