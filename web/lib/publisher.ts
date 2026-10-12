import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAddress, isAddress, type Hex } from "viem";

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

export const publisherStore = createPublisherStore(
  join(process.cwd(), ".data", "publisher.json"),
  process.env.PUBLISHER_ADDRESS,
);
