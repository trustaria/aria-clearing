import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, isAddress, type Address } from "viem";

export const DEFAULT_RPC_URL = "https://testnet-rpc.monad.xyz";

/** Values from deployments/10143.json, used when the file is not next to the web app. */
const FALLBACK = {
  address: "0xfb6bA8e6c48c806AFC40aFee5F85deE42Ce8F2fb",
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  deployBlock: 70478614,
};

export interface Deployment {
  clearing: Address;
  usdc: Address;
  deployBlock: bigint;
  rpcUrl: string;
}

/** Contract addresses, deploy block and RPC for server code. Reads the deployment file on each call. */
export function deployment(): Deployment {
  const file = join(process.cwd(), "..", "deployments", "10143.json");
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<typeof FALLBACK>) : {};
  const envClearing = process.env.NEXT_PUBLIC_CLEARING_ADDRESS;
  const clearing = envClearing && isAddress(envClearing) ? envClearing : (saved.address ?? FALLBACK.address);
  return {
    clearing: getAddress(clearing),
    usdc: getAddress(saved.usdc ?? FALLBACK.usdc),
    deployBlock: BigInt(saved.deployBlock ?? FALLBACK.deployBlock),
    rpcUrl: process.env.MONAD_TESTNET_RPC_URL || DEFAULT_RPC_URL,
  };
}
