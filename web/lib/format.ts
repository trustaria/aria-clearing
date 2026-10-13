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

/** USDC base units as dollars, e.g. 260000n → "$0.26". */
export function formatDollars(amount: bigint): string {
  return `$${formatUsdc(amount)}`;
}

/** A fraction as a percentage with one decimal; "—" when there is nothing to divide. */
export function formatPercent(fraction: number | null): string {
  return fraction === null ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** Basis points as a percentage, e.g. 2000 → "20 %", 2050 → "20.5 %". */
export function formatShare(bps: number): string {
  return `${Number((bps / 100).toFixed(2))} %`;
}

/** Masked publisher id shown to developers: a fixed prefix and the address's last four characters. */
export function publisherKey(address: string): string {
  return `pk_live_••••${address.slice(-4).toLowerCase()}`;
}

/** Age of a unix-seconds time relative to `now` (also unix seconds), e.g. "3 min ago". */
export function timeAgo(time: number, now: number): string {
  const seconds = Math.max(0, Math.round(now - time));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
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
