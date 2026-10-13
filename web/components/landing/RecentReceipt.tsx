import Link from "next/link";
import { recentReceiptId } from "../../lib/landing";

/** Proof list item linking the newest released receipt; nothing when Envio has none or is unavailable. */
export default async function RecentReceipt() {
  const requestId = await recentReceiptId();
  if (!requestId) return null;
  return (
    <li>
      <Link
        href={`/receipt/${requestId}`}
        className="rounded font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 transition hover:decoration-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
      >
        A recent live receipt
      </Link>
      <span className="ml-2 font-mono text-xs text-stone-500">{requestId}</span>
    </li>
  );
}
