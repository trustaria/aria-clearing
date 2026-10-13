"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setDemoBarHidden } from "../lib/demo-bar";
import { activeSection, DEMO_LINKS, REPO_URL } from "../lib/demo-nav";
import ExternalLink from "./ExternalLink";

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white";
const ITEM = `rounded px-1.5 py-0.5 text-neutral-300 transition hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:text-white ${FOCUS}`;
const MENU_ITEM = `block rounded px-2 py-2 text-neutral-200 hover:bg-white/10 aria-[current=page]:bg-white/15 aria-[current=page]:font-semibold aria-[current=page]:text-white ${FOCUS}`;

/** Thin demo navigation strip above every page, in normal flow so it never covers the page. */
export default function DemoBar() {
  const pathname = usePathname();
  const active = activeSection(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const current = (section: string) => (active === section ? "page" : undefined);

  return (
    <nav
      aria-label="Demo"
      className="demo-bar relative z-40 border-b border-neutral-800 bg-neutral-900 font-sans text-xs text-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
    >
      <div className="flex h-8 items-center gap-3 px-3 sm:px-4">
        <Link
          href="/"
          aria-current={current("overview")}
          className={`rounded px-1.5 py-0.5 font-semibold text-white aria-[current=page]:bg-white/15 ${FOCUS}`}
        >
          Aria Clearing demo
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {DEMO_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} aria-current={current(link.section)} className={ITEM}>
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/#how-it-works" className={ITEM}>
              How it works
            </Link>
          </li>
          <li>
            <ExternalLink href={REPO_URL} className={ITEM}>
              GitHub
            </ExternalLink>
          </li>
        </ul>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="demo-bar-menu"
            className={`rounded px-2 py-0.5 text-neutral-200 hover:bg-white/10 md:hidden ${FOCUS}`}
          >
            Menu
          </button>
          <button
            type="button"
            onClick={() => setDemoBarHidden(true)}
            aria-label="Hide the demo bar"
            title="Hide the demo bar"
            className={`rounded px-1.5 text-base leading-none text-neutral-400 hover:text-white ${FOCUS}`}
          >
            ×
          </button>
        </div>
      </div>
      {menuOpen && (
        <ul
          id="demo-bar-menu"
          className="absolute inset-x-0 top-full space-y-0.5 border-b border-neutral-800 bg-neutral-900 p-2 text-sm shadow-lg md:hidden dark:border-neutral-700 dark:bg-neutral-800"
        >
          {DEMO_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} aria-current={current(link.section)} className={MENU_ITEM}>
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/#how-it-works" onClick={() => setMenuOpen(false)} className={MENU_ITEM}>
              How it works
            </Link>
          </li>
          <li>
            <ExternalLink href={REPO_URL} className={MENU_ITEM}>
              GitHub
            </ExternalLink>
          </li>
        </ul>
      )}
    </nav>
  );
}

/** Button that brings a dismissed demo bar back; only visible while the bar is hidden. */
export function ShowDemoBar({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => setDemoBarHidden(false)} className={`demo-bar-restore hidden ${className ?? ""}`}>
      Show the demo bar
    </button>
  );
}
