// Browser side of the demo key: kept in sessionStorage for the tab, sent as a header.

export const DEMO_KEY_HEADER = "x-aria-demo-key";

const STORAGE_KEY = "aria.demoKey";

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): KeyStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The `debug` query value of `href` and the same URL without it (path, remaining query and hash). */
export function takeDebugParam(href: string): { value: string | null; cleaned: string } {
  const url = new URL(href);
  const value = url.searchParams.get("debug");
  url.searchParams.delete("debug");
  return { value, cleaned: `${url.pathname}${url.search}${url.hash}` };
}

export function saveDemoKey(key: string, storage: KeyStorage | null = sessionStore()): void {
  try {
    storage?.setItem(STORAGE_KEY, key);
  } catch {
    // Storage blocked: the key lives only as long as the page.
  }
}

export function storedDemoKey(storage: KeyStorage | null = sessionStore()): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetDemoKey(storage: KeyStorage | null = sessionStore()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** `{x-aria-demo-key}` when this tab holds a key, else `{}`. */
export function demoKeyHeaders(storage: KeyStorage | null = sessionStore()): Record<string, string> {
  const key = storedDemoKey(storage);
  return key ? { [DEMO_KEY_HEADER]: key } : {};
}
