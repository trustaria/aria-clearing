export const REPO_URL = "https://github.com/trustaria/aria-clearing";

export type DemoSection = "overview" | "chat" | "dashboard" | "advertise";

export const DEMO_LINKS: { section: DemoSection; label: string; href: string }[] = [
  { section: "chat", label: "AI chat", href: "/ai-chat" },
  { section: "dashboard", label: "Publisher dashboard", href: "/dashboard" },
  { section: "advertise", label: "Advertiser console", href: "/advertise" },
];

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** The demo bar section `pathname` belongs to; null for pages outside the bar (receipts, offline page). */
export function activeSection(pathname: string | null): DemoSection | null {
  if (!pathname) return null;
  if (pathname === "/") return "overview";
  if (under(pathname, "/ai-chat")) return "chat";
  if (under(pathname, "/dashboard")) return "dashboard";
  if (under(pathname, "/advertise")) return "advertise";
  return null;
}
