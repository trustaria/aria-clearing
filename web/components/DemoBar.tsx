"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setDemoBarHidden } from "../lib/demo-bar";
import { activeSection, DEMO_LINKS, REPO_URL } from "../lib/demo-nav";
import { AriaLogo } from "./AriaBrand";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 dark:focus-visible:outline-stone-100";
const ITEM = `rounded-md px-2.5 py-1.5 text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white dark:aria-[current=page]:bg-stone-100 dark:aria-[current=page]:text-stone-900 ${FOCUS}`;
const QUIET = `rounded-md px-2 py-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white ${FOCUS}`;
const MENU_ITEM = `block rounded-md px-3 py-2.5 text-stone-700 hover:bg-stone-100 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white dark:text-stone-200 dark:hover:bg-stone-800 dark:aria-[current=page]:bg-stone-100 dark:aria-[current=page]:text-stone-900 ${FOCUS}`;

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Demo navigation strip above every page, in normal flow so it never covers the page. */
export default function DemoBar() {
  const pathname = usePathname();
  const active = activeSection(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const current = (section: string) =>
    active === section ? "page" : undefined;

  return (
    <nav
      aria-label="Demo"
      className="demo-bar relative z-40 border-b border-stone-200 bg-[#faf9f6] font-sans text-sm dark:border-stone-800 dark:bg-stone-950"
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-current={current("overview")}
          className={`mr-2 flex items-center gap-2 rounded-md py-1 font-semibold text-stone-900 dark:text-white ${FOCUS}`}
        >
          <AriaLogo className="h-6 w-6" />
          <span>Aria Clearing</span>
          <span className="rounded border border-stone-300 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:border-stone-700 dark:text-stone-400">
            demo
          </span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {DEMO_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current(link.section)}
                className={ITEM}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/#how-it-works"
            className={`hidden md:inline-block ${QUIET}`}
          >
            How it works
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center ${QUIET}`}
          >
            <GitHubMark />
            <span className="sr-only">GitHub (opens in a new tab)</span>
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="demo-bar-menu"
            className={`md:hidden ${QUIET}`}
          >
            Menu
          </button>
          <button
            type="button"
            onClick={() => setDemoBarHidden(true)}
            aria-label="Hide the demo bar"
            title="Hide the demo bar"
            className={`text-lg leading-none ${QUIET}`}
          >
            ×
          </button>
        </div>
      </div>
      {menuOpen && (
        <ul
          id="demo-bar-menu"
          className="absolute inset-x-0 top-full space-y-0.5 border-b border-stone-200 bg-[#faf9f6] p-2 shadow-lg md:hidden dark:border-stone-800 dark:bg-stone-950"
        >
          {DEMO_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current(link.section)}
                className={MENU_ITEM}
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/#how-it-works"
              onClick={() => setMenuOpen(false)}
              className={MENU_ITEM}
            >
              How it works
            </Link>
          </li>
        </ul>
      )}
    </nav>
  );
}

/** Button that brings a dismissed demo bar back; only visible while the bar is hidden. */
export function ShowDemoBar({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => setDemoBarHidden(false)}
      className={`demo-bar-restore hidden ${className ?? ""}`}
    >
      Show the demo bar
    </button>
  );
}
