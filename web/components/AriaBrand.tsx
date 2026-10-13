import Link from "next/link";

/** The Aria mark, drawn like /icons/aria.svg. */
export function AriaLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden focusable="false">
      <rect width="512" height="512" rx="112" fill="#0A0E13" />
      <polygon points="124,404 256,104 388,404 316,404 256,268 196,404" fill="#F5F6F7" />
      <circle cx="256" cy="352" r="26" fill="#E8A33D" />
    </svg>
  );
}

/** Eyebrow of Aria's pages: the mark and "Aria" link to the demo overview, followed by `children`. */
export function AriaEyebrow({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
      <Link
        href="/"
        className="-ml-0.5 inline-flex items-center gap-1.5 rounded px-0.5 text-stone-700 transition hover:text-stone-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
      >
        <AriaLogo className="h-4 w-4" />
        Aria
      </Link>
      {children}
    </p>
  );
}
