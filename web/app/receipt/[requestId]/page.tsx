import type { Metadata } from "next";
import { Suspense } from "react";
import AutoRefresh from "../../../components/receipt/AutoRefresh";
import CopyCommand from "../../../components/receipt/CopyCommand";
import ReceiptDocument from "../../../components/receipt/ReceiptDocument";
import { ARIA_ICONS } from "../../../lib/brand-icons";
import { getPublisherStats } from "../../../lib/envio";
import { addressUrl, shortAddress } from "../../../lib/format";
import { loadReceipt } from "../load";
import { expectedFromQuery, toReceiptView, trustLine, verifyCommand } from "../view-model";

export const dynamic = "force-dynamic";

const PENDING_REFRESH_MS = 4_000;

type Props = {
  params: { requestId: string };
  /** `h` and `c`: the card's rationaleHash and claimsHash. */
  searchParams?: Record<string, string | string[] | undefined>;
};

export function generateMetadata({ params }: Props): Metadata {
  return { title: `Receipt ${safeDecode(params.requestId)}`, icons: ARIA_ICONS };
}

/** Publisher verification rate from the indexer; renders nothing when unavailable. Streams in without blocking the receipt. */
async function PublisherTrust({ publisher }: { publisher: string }) {
  const line = trustLine(await getPublisherStats(publisher));
  return line ? <span>{line}</span> : null;
}

function Notice({
  requestId,
  contract,
  title,
  body,
}: {
  requestId: string;
  contract: string;
  title: string;
  body: string;
}) {
  return (
    <article className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Aria receipt</p>
        <p className="mt-1 font-mono text-sm text-stone-500">{requestId}</p>
      </div>
      <div className="space-y-3">
        <h1 className="font-serif text-[1.75rem] leading-snug text-stone-900">{title}</h1>
        <p className="max-w-prose text-[15px] leading-relaxed text-stone-600">{body}</p>
      </div>
      <CopyCommand command={verifyCommand(requestId)} />
      <p className="text-xs text-stone-500">
        Contract{" "}
        <a
          href={addressUrl(contract)}
          target="_blank"
          rel="noreferrer"
          className="font-mono underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
        >
          {shortAddress(contract)}
        </a>{" "}
        · Monad testnet
      </p>
    </article>
  );
}

export default async function ReceiptPage({ params, searchParams }: Props) {
  const requestId = safeDecode(params.requestId);
  const result = await loadReceipt(requestId, expectedFromQuery(searchParams ?? {}));

  let content: React.ReactNode;
  let refresh = true;
  if (result.state === "found") {
    const view = toReceiptView(result.receipt, result.contract);
    const publisher = result.receipt.events[0]?.publisher;
    const trust = publisher ? (
      <Suspense fallback={null}>
        <PublisherTrust publisher={publisher} />
      </Suspense>
    ) : null;
    content = <ReceiptDocument view={view} trust={trust} />;
    refresh = !view.final;
  } else if (result.state === "missing") {
    content = (
      <Notice
        requestId={requestId}
        contract={result.contract}
        title="Not on chain yet"
        body="No impression or click with this request id has been logged on Monad yet. Events are logged a few seconds after the card is seen; this page refreshes on its own."
      />
    );
  } else {
    content = (
      <Notice
        requestId={requestId}
        contract={result.contract}
        title="Could not read the chain"
        body={`The RPC call failed: ${result.message}. This page retries on its own.`}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className="mx-auto max-w-2xl px-6 py-14 sm:py-20">{content}</div>
      {refresh && <AutoRefresh ms={PENDING_REFRESH_MS} />}
    </main>
  );
}

/** Decodes a URL segment; a malformed `%` sequence is kept as typed instead of throwing. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
