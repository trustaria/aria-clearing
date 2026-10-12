"use client";

import { useState } from "react";

export default function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-stone-200 bg-white">
      <code className="flex-1 px-4 [overflow-wrap:anywhere] py-3 font-mono text-[13px] text-stone-700">
        <span className="select-none text-stone-400">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="border-l border-stone-200 px-4 text-xs font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-900"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
