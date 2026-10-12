import { describe, expect, it, vi } from "vitest";
import {
  MAX_TEXT,
  brandFromSite,
  extractSite,
  isBlockedAddress,
  isBlockedHostname,
  readSite,
  type Getter,
  type Hop,
  type Resolver,
} from "../lib/site-reader";

const FIXTURE = `<!doctype html>
<html><head>
  <title>Compact espresso at home &ndash; Crema Works</title>
  <meta content="Crema Works makes compact espresso machines for small kitchens." name="description">
  <meta property='og:title' content='Crema Works'>
  <meta property="og:description" content="Home espresso, made small &amp; simple.">
  <meta property="og:site_name" content="Crema Works">
  <style>body { color: red; }</style>
  <script>window.secret = "do not read";</script>
  <script type="application/ld+json">{"@type":"Product","name":"hidden"}</script>
</head><body>
  <nav><a href="/">Home</a><a href="/shop">Shop all</a></nav>
  <main>
    <h1>Espresso for small kitchens</h1>
    <!-- a comment that should vanish -->
    <p>Every machine has a 15-bar pump<br>and a steam wand.</p>
    <p>We ship free across the EU in 3&nbsp;days.</p>
    <noscript>Enable JavaScript</noscript>
    <svg><text>icon</text></svg>
  </main>
  <footer>© 2026 Crema Works · Privacy</footer>
</body></html>`;

const PUBLIC_IP = "93.184.216.34";

function hop(partial: Partial<Hop> = {}): Hop {
  return { status: 200, location: null, contentType: "text/html; charset=utf-8", body: FIXTURE, ...partial };
}

function deps(dns: Record<string, string[]>, pages: Record<string, Hop>) {
  const resolve: Resolver = vi.fn(async (host: string) => {
    if (!dns[host]) throw new Error(`ENOTFOUND ${host}`);
    return dns[host];
  });
  const get: Getter = vi.fn(async (url: URL) => {
    const page = pages[url.href];
    if (!page) throw new Error(`no page for ${url.href}`);
    return page;
  });
  return { resolve, get };
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "not an ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([PUBLIC_IP, "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it.each(["localhost", "LOCALHOST", "app.localhost", "printer.local", "metadata.google.internal", "intranet"])(
    "blocks %s",
    (host) => {
      expect(isBlockedHostname(host)).toBe(true);
    },
  );

  it("allows a public name", () => {
    expect(isBlockedHostname("crema.works")).toBe(false);
  });
});

describe("readSite: SSRF guard", () => {
  it("accepts only https", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, {});
    expect(await readSite("http://crema.works/", d)).toEqual({ error: "invalid_url" });
    expect(await readSite("ftp://crema.works/", d)).toEqual({ error: "invalid_url" });
    expect(await readSite("not a url", d)).toEqual({ error: "invalid_url" });
    expect(d.get).not.toHaveBeenCalled();
  });

  it("refuses credentials and non-default ports", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, {});
    expect(await readSite("https://user:pw@crema.works/", d)).toEqual({ error: "blocked" });
    expect(await readSite("https://crema.works:8443/", d)).toEqual({ error: "blocked" });
    expect(d.get).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://localhost/",
    "https://foo.localhost/",
  ])("refuses %s without fetching", async (url) => {
    const d = deps({ localhost: ["127.0.0.1"], "foo.localhost": ["127.0.0.1"] }, {});
    expect(await readSite(url, d)).toEqual({ error: "blocked" });
    expect(d.get).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves to a private address", async () => {
    const d = deps({ "evil.example": [PUBLIC_IP, "10.0.0.7"] }, {});
    expect(await readSite("https://evil.example/", d)).toEqual({ error: "blocked" });
    expect(d.get).not.toHaveBeenCalled();
  });

  it("connects to the address it checked", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, { "https://crema.works/": hop() });
    await readSite("https://crema.works/", d);
    expect(d.get).toHaveBeenCalledWith(new URL("https://crema.works/"), PUBLIC_IP, expect.any(AbortSignal));
  });

  it("re-checks every redirect hop and refuses a redirect to a private address", async () => {
    const d = deps(
      { "crema.works": [PUBLIC_IP], "internal.crema.works": ["192.168.0.10"] },
      { "https://crema.works/": hop({ status: 302, location: "https://internal.crema.works/admin", body: "" }) },
    );
    expect(await readSite("https://crema.works/", d)).toEqual({ error: "blocked" });
    expect(d.get).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to the metadata address or to plain http", async () => {
    const meta = deps(
      { "crema.works": [PUBLIC_IP] },
      { "https://crema.works/": hop({ status: 301, location: "https://169.254.169.254/", body: "" }) },
    );
    expect(await readSite("https://crema.works/", meta)).toEqual({ error: "blocked" });
    const http = deps(
      { "crema.works": [PUBLIC_IP] },
      { "https://crema.works/": hop({ status: 301, location: "http://crema.works/", body: "" }) },
    );
    expect(await readSite("https://crema.works/", http)).toEqual({ error: "invalid_url" });
  });

  it("follows up to 3 redirects, resolving relative locations", async () => {
    const d = deps(
      { "crema.works": [PUBLIC_IP], "www.crema.works": [PUBLIC_IP] },
      {
        "https://crema.works/": hop({ status: 301, location: "https://www.crema.works/", body: "" }),
        "https://www.crema.works/": hop({ status: 302, location: "/en", body: "" }),
        "https://www.crema.works/en": hop({ status: 307, location: "/en/home", body: "" }),
        "https://www.crema.works/en/home": hop(),
      },
    );
    const result = await readSite("https://crema.works/", d);
    if (!("site" in result)) throw new Error(`expected a site, got ${result.error}`);
    expect(result.site.url).toBe("https://www.crema.works/en/home");
    expect(d.resolve).toHaveBeenCalledWith("www.crema.works");
  });

  it("stops after 3 redirects", async () => {
    const pages: Record<string, Hop> = {};
    for (let i = 0; i < 5; i++) pages[`https://crema.works/${i}`] = hop({ status: 302, location: `/${i + 1}`, body: "" });
    const d = deps({ "crema.works": [PUBLIC_IP] }, pages);
    expect(await readSite("https://crema.works/0", d)).toEqual({ error: "too_many_redirects" });
    expect(d.get).toHaveBeenCalledTimes(4);
  });
});

describe("readSite: responses", () => {
  it("returns unreachable when DNS or the request fails", async () => {
    expect(await readSite("https://nowhere.example/", deps({}, {}))).toEqual({ error: "unreachable" });
    const d = deps({ "crema.works": [PUBLIC_IP] }, {});
    expect(await readSite("https://crema.works/", d)).toEqual({ error: "unreachable" });
  });

  it("returns unreachable for an error status", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, { "https://crema.works/": hop({ status: 404 }) });
    expect(await readSite("https://crema.works/", d)).toEqual({ error: "unreachable" });
  });

  it("refuses a page that is not HTML", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, { "https://crema.works/": hop({ contentType: "application/pdf" }) });
    expect(await readSite("https://crema.works/", d)).toEqual({ error: "not_html" });
  });

  it("returns empty for a page with no text", async () => {
    const d = deps(
      { "crema.works": [PUBLIC_IP] },
      { "https://crema.works/": hop({ body: "<html><head><title></title></head><body><script>x()</script></body></html>" }) },
    );
    expect(await readSite("https://crema.works/", d)).toEqual({ error: "empty" });
  });

  it("gives up after the timeout", async () => {
    const d = deps({ "crema.works": [PUBLIC_IP] }, {});
    const slow: Getter = (_url, _ip, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await readSite("https://crema.works/", { ...d, get: slow, timeoutMs: 20 })).toEqual({ error: "unreachable" });
  });
});

describe("extractSite", () => {
  const site = extractSite(FIXTURE, "https://crema.works/");

  it("reads the title and meta tags in any attribute order", () => {
    expect(site.title).toBe("Compact espresso at home – Crema Works");
    expect(site.description).toBe("Crema Works makes compact espresso machines for small kitchens.");
    expect(site.ogTitle).toBe("Crema Works");
    expect(site.ogDescription).toBe("Home espresso, made small & simple.");
    expect(site.siteName).toBe("Crema Works");
  });

  it("keeps visible main text and drops scripts, styles, nav, footer and comments", () => {
    expect(site.text).toBe(
      "Espresso for small kitchens Every machine has a 15-bar pump and a steam wand. We ship free across the EU in 3 days.",
    );
  });

  it("uses the body when there is no main element", () => {
    const html = "<html><body><nav>Menu</nav><h1>Trail boots</h1><p>Waterproof &#38; light.</p></body></html>";
    expect(extractSite(html, "https://x.example/").text).toBe("Trail boots Waterproof & light.");
  });

  it("caps the text", () => {
    const html = `<main><p>${"word ".repeat(5000)}</p></main>`;
    const text = extractSite(html, "https://x.example/").text;
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(text.endsWith("word")).toBe(true);
  });
});

describe("brandFromSite", () => {
  const base = { url: "https://www.axy.digital/", title: "", description: "", ogTitle: "", ogDescription: "", siteName: "", text: "" };

  it("prefers og:site_name", () => {
    expect(brandFromSite({ ...base, siteName: "Axy", title: "Something — Axy.digital" })).toBe("Axy");
  });

  it("picks the title segment that matches the host", () => {
    expect(brandFromSite({ ...base, title: "Algorithmic Marketing on Autopilot — Axy.digital" })).toBe("Axy.digital");
    expect(brandFromSite({ ...base, url: "https://hausofveil.com/", title: "HAUS OF VEIL – Haus Of Veil" })).toBe(
      "HAUS OF VEIL",
    );
  });

  it("falls back to the host name", () => {
    expect(brandFromSite({ ...base, title: "Welcome" })).toBe("Axy");
  });
});
