"use client";

import { useState } from "react";
import { Section } from "../receipt/ReceiptDocument";

/** How Nova, the reference chat app in this repo, adds Aria (web/components/Chat.tsx). */
export const INTEGRATION_SNIPPET = `const res = await fetch("/api/chat", {
  method: "POST",
  body: JSON.stringify({ messages }),
});
// The answer streams as NDJSON; a "card" frame carries the served ad
await readFrames(res, (frame) => {
  if (frame.type === "text") appendAnswer(frame.delta);
  if (frame.type === "card") setAd(frame.ad);
});
// Beacons the view to Aria; the click goes through Aria's redirect
{ad && <AriaAdCard ad={ad} appearance="blockquote" clickArea="card" />}`;

export default function IntegrationPanel({ publisherId }: { publisherId: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(INTEGRATION_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="Integration">
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-stone-900">Publisher ID</p>
            <p className="text-xs text-stone-500">Every impression and click your app serves is credited to this ID.</p>
          </div>
          <code className="rounded-md bg-white px-3 py-1.5 font-mono text-sm text-stone-700 ring-1 ring-stone-200">
            {publisherId ?? "…"}
          </code>
        </div>

        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
            <span className="text-xs text-stone-500">Example from Nova, this repo&apos;s chat app</span>
            <button
              type="button"
              onClick={copy}
              className="text-xs font-medium text-stone-600 transition hover:text-stone-900"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-stone-700">
            <code>{INTEGRATION_SNIPPET}</code>
          </pre>
        </div>
        <p className="text-xs leading-relaxed text-stone-500">
          <span className="font-mono">/api/chat</span> answers and asks Aria for the ad;{" "}
          <span className="font-mono">AriaAdCard</span> from <span className="font-mono">@trustaria/react</span> renders
          it, and Nova adds its receipt beside it.
        </p>
      </div>
    </Section>
  );
}
