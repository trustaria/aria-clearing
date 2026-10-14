"use client";

import { useState } from "react";
import { Section } from "../receipt/ReceiptDocument";

const NPM_CORE = "https://www.npmjs.com/package/@trustaria/core";
const NPM_REACT = "https://www.npmjs.com/package/@trustaria/react";
const NPM_LINK = "font-mono underline underline-offset-2 hover:text-stone-900";

/** How a publisher adds Aria with the published SDK, as Nova does in this repo. */
export const INTEGRATION_SNIPPET = `// npm install @trustaria/core @trustaria/react

// Server, in your chat route: ask Aria for an ad alongside your LLM call
import { createAria } from "@trustaria/core";

const aria = createAria({
  apiKey: process.env.ARIA_SECRET_KEY!,
  publisherId: "pub_nova",
  baseUrl: process.env.ARIA_BASE_URL!,
});

const adPromise = aria.serve({ prompt, context, sessionId });
const answer = await callYourLlm(messages);
const { ad } = await adPromise; // AdPayload | null, never throws

// Browser: the view is beaconed straight to Aria; the click goes through Aria's redirect
import { AriaAdCard } from "@trustaria/react";

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
            <span className="text-xs text-stone-500">Aria SDK, as Nova uses it</span>
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
          <a href={NPM_CORE} target="_blank" rel="noopener noreferrer" className={NPM_LINK}>
            @trustaria/core<span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          runs on your server next to the LLM call;{" "}
          <a href={NPM_REACT} target="_blank" rel="noopener noreferrer" className={NPM_LINK}>
            @trustaria/react<span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          renders the card and measures the view. Nova adds its receipt beside the card.
        </p>
      </div>
    </Section>
  );
}
