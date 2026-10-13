// Per-viewer "hide the demo bar" choice: a localStorage flag mirrored on <html data-demo-bar="hidden">.

const STORAGE_KEY = "aria.demoBar";
const HIDDEN = "hidden";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Root = { dataset: DOMStringMap };

/** Inline <head> script: applies a stored dismissal before first paint. */
export const DEMO_BAR_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})===${JSON.stringify(HIDDEN)})document.documentElement.dataset.demoBar=${JSON.stringify(HIDDEN)}}catch(e){}`;

function localStore(): FlagStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Hides or shows the bar on this page and remembers it when storage allows. */
export function setDemoBarHidden(
  hidden: boolean,
  storage: FlagStorage | null = localStore(),
  root: Root = document.documentElement,
): void {
  if (hidden) root.dataset.demoBar = HIDDEN;
  else delete root.dataset.demoBar;
  try {
    if (hidden) storage?.setItem(STORAGE_KEY, HIDDEN);
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
