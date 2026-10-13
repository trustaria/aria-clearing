import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPage from "../app/page";
import Landing from "../components/landing/Landing";
import RecentReceipt from "../components/landing/RecentReceipt";
import { forgetRecentReceipt, proofLinks, recentReceiptId } from "../lib/landing";

const CONTRACT = "0x431e97E2EB23ac06C9f807cC8DCe54499C1bDC7B";
const REQUEST_ID = "req_rPLLG0Y5cyHvblTNRXcYvc";

function respondWith(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

const released = { data: { ClearingEvent: [{ requestId: REQUEST_ID }] } };

beforeEach(() => forgetRecentReceipt());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("landing route", () => {
  it("redirects /?debug=x to the chat with the same query", () => {
    let thrown: unknown;
    try {
      LandingPage({ searchParams: { debug: "x" } });
    } catch (error) {
      thrown = error;
    }
    expect(String((thrown as { digest?: string })?.digest)).toContain(";/ai-chat?debug=x;");
  });

  it("renders the landing for plain /", () => {
    const page = LandingPage({ searchParams: {} });
    expect(page.type).toBe(Landing);
  });
});

describe("Landing", () => {
  const html = renderToStaticMarkup(<Landing contract={CONTRACT} envioUrl={null} recentReceipt={null} />);

  it("links the three roles", () => {
    expect(html).toContain('href="/ai-chat"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/advertise"');
    expect(html).toContain("Publisher dashboard");
    expect(html).toContain("Advertiser console");
  });

  it("has the how-it-works anchor and says when links open a new tab", () => {
    expect(html).toContain('id="how-it-works"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });
});

describe("proofLinks", () => {
  it("lists the contract, npm packages and repo, and the Envio endpoint when set", () => {
    const links = proofLinks({ contract: CONTRACT, envioUrl: "https://indexer.test/v1/graphql" });
    expect(links.map((l) => l.href)).toEqual([
      `https://testnet.monadvision.com/address/${CONTRACT}`,
      "https://indexer.test/v1/graphql",
      "https://www.npmjs.com/package/@trustaria/core",
      "https://www.npmjs.com/package/@trustaria/react",
      "https://github.com/trustaria/aria-clearing",
    ]);
  });

  it("hides the Envio endpoint when unset", () => {
    expect(proofLinks({ contract: CONTRACT, envioUrl: null }).some((l) => l.label.includes("Envio"))).toBe(false);
  });
});

describe("recent receipt", () => {
  it("links the newest released receipt", async () => {
    vi.stubGlobal("fetch", respondWith(released));
    const html = renderToStaticMarkup(await RecentReceipt());
    expect(html).toContain(`href="/receipt/${REQUEST_ID}"`);
  });

  it("renders nothing when Envio fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await RecentReceipt()).toBeNull();
  });

  it("caches the answer for a short time", async () => {
    const fetchMock = respondWith(released);
    vi.stubGlobal("fetch", fetchMock);
    expect(await recentReceiptId(1_000)).toBe(REQUEST_ID);
    expect(await recentReceiptId(20_000)).toBe(REQUEST_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await recentReceiptId(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a failure too, then asks again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await recentReceiptId(1_000)).toBeNull();
    vi.stubGlobal("fetch", respondWith(released));
    expect(await recentReceiptId(2_000)).toBeNull();
    expect(await recentReceiptId(40_000)).toBe(REQUEST_ID);
  });
});
