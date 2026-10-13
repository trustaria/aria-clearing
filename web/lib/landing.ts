import { REPO_URL } from "./demo-nav";
import { getLatestReleasedRequestId } from "./envio";
import { addressUrl, shortAddress } from "./format";

/** How long one Envio answer (or failure) is reused for the landing's receipt link. */
const RECENT_RECEIPT_TTL_MS = 30_000;

let recent: { at: number; requestId: Promise<string | null> } | null = null;

/** Newest released requestId, shared by concurrent requests and reused for a short time; null when Envio fails. */
export function recentReceiptId(now = Date.now()): Promise<string | null> {
  if (!recent || now - recent.at >= RECENT_RECEIPT_TTL_MS) {
    recent = { at: now, requestId: getLatestReleasedRequestId() };
  }
  return recent.requestId;
}

/** Clears the cached requestId. */
export function forgetRecentReceipt(): void {
  recent = null;
}

export interface ProofLink {
  label: string;
  detail?: string;
  href: string;
}

/** External proof links; the Envio endpoint only when one is configured. */
export function proofLinks({ contract, envioUrl }: { contract: string; envioUrl: string | null }): ProofLink[] {
  return [
    { label: "Contract on MonadVision", detail: shortAddress(contract), href: addressUrl(contract) },
    ...(envioUrl ? [{ label: "Envio GraphQL endpoint", href: envioUrl }] : []),
    { label: "@trustaria/core", detail: "npm", href: "https://www.npmjs.com/package/@trustaria/core" },
    { label: "@trustaria/react", detail: "npm", href: "https://www.npmjs.com/package/@trustaria/react" },
    { label: "Source on GitHub", detail: "trustaria/aria-clearing", href: REPO_URL },
  ];
}
