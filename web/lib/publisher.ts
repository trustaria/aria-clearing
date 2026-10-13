import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress, type Hex } from "viem";
import { dataFile } from "./data-dir";

export type PublisherStore = {
  get(): Hex | undefined;
  set(address: string): void;
};

/** The publisher address events are credited to: the logged-in Privy wallet, else the fallback. */
export function createPublisherStore(file: string, fallback: string | undefined): PublisherStore {
  return {
    get() {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, "utf8")) as { address?: string };
        if (saved.address && isAddress(saved.address)) return getAddress(saved.address);
      }
      return fallback && isAddress(fallback) ? getAddress(fallback) : undefined;
    },
    set(address) {
      if (!isAddress(address)) throw new Error("Invalid publisher address");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ address: getAddress(address) }));
    },
  };
}

function appStore(): PublisherStore {
  return createPublisherStore(dataFile("publisher.json", process.env.ARIA_PUBLISHER_FILE), process.env.PUBLISHER_ADDRESS);
}

/** The app's store: ARIA_PUBLISHER_FILE, else `publisher.json` in the data dir; env is read on every call. */
export const publisherStore: PublisherStore = {
  get: () => appStore().get(),
  set: (address) => appStore().set(address),
};
