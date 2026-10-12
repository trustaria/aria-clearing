import { formatUnits } from "viem";

export const EXPLORER_URL = "https://testnet.monadvision.com";
export const USDC_DECIMALS = 6;

const MON_DECIMALS = 18;
const MON_PLACES = 4;

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** USDC base units as a decimal string with at least two decimals. */
export function formatUsdc(amount: bigint): string {
  const [whole, fraction = ""] = formatUnits(amount, USDC_DECIMALS).split(".");
  return `${groupThousands(whole)}.${fraction.padEnd(2, "0")}`;
}

/** MON wei truncated to four decimals; a non-zero dust balance shows as "<0.0001". */
export function formatMon(wei: bigint): string {
  const [whole, fraction = ""] = formatUnits(wei, MON_DECIMALS).split(".");
  const kept = fraction.slice(0, MON_PLACES).replace(/0+$/, "");
  if (wei > 0n && whole === "0" && kept === "") return `<0.${"0".repeat(MON_PLACES - 1)}1`;
  return kept ? `${groupThousands(whole)}.${kept}` : groupThousands(whole);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
