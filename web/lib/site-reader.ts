import { promises as dns } from "node:dns";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

// Reads a public https page for the claims draft: SSRF-guarded fetch plus plain-text extraction.

export const READ_TIMEOUT_MS = 5000;
export const MAX_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const MAX_TEXT = 6000;

const USER_AGENT = "Mozilla/5.0 (compatible; AriaSiteReader/1.0; +https://aria.ad)";

export type Site = {
  /** The final URL after redirects. */
  url: string;
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  siteName: string;
  /** Visible main text, whitespace collapsed, at most MAX_TEXT characters. */
  text: string;
};

export type SiteError = "invalid_url" | "blocked" | "unreachable" | "not_html" | "too_many_redirects" | "empty";
export type SiteResult = { site: Site } | { error: SiteError };

/** Resolves a hostname to every address it has. */
export type Resolver = (host: string) => Promise<string[]>;
/** One response; `body` is empty for redirects, errors and non-HTML. */
export type Hop = { status: number; location: string | null; contentType: string; body: string };
/** Fetches one URL over a connection to `address`, never re-resolving the hostname. */
export type Getter = (url: URL, address: string, signal: AbortSignal) => Promise<Hop>;

export type ReadDeps = { resolve?: Resolver; get?: Getter; timeoutMs?: number };

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6: [string, number][] = [
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const V4_LIST = new net.BlockList();
for (const [prefix, bits] of BLOCKED_V4) V4_LIST.addSubnet(prefix, bits, "ipv4");
const V6_LIST = new net.BlockList();
for (const [prefix, bits] of BLOCKED_V6) V6_LIST.addSubnet(prefix, bits, "ipv6");

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".arpa", ".lan", ".home"];

/** The eight 16-bit groups of an IPv6 address, including a trailing dotted IPv4 part. */
function hextets(ip: string): number[] {
  let s = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const left = head ? head.split(":") : [];
  if (tail === undefined) return left.map((p) => parseInt(p, 16));
  const right = tail ? tail.split(":") : [];
  return [...left, ...Array(8 - left.length - right.length).fill("0"), ...right].map((p) => parseInt(p, 16));
}

/** True for private, loopback, link-local, metadata, multicast and reserved addresses, and for non-addresses. */
export function isBlockedAddress(ip: string): boolean {
  const address = ip.split("%")[0];
  const kind = net.isIP(address);
  if (kind === 4) return V4_LIST.check(address, "ipv4");
  if (kind !== 6) return true;
  const groups = hextets(address);
  if (groups.slice(0, 5).every((g) => g === 0)) {
    // ::ffff:a.b.c.d is checked as IPv4; ::, ::1 and the other IPv4-compatible forms are refused.
    if (groups[5] !== 0xffff) return true;
    const v4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
    return V4_LIST.check(v4, "ipv4");
  }
  return V6_LIST.check(address, "ipv6");
}

/** True for localhost, single-label names and local-only suffixes. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || !host.includes(".")) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function parseHttps(text: string, base?: URL): URL | null {
  try {
    const url = new URL(text.trim(), base);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function checkTarget(url: URL, resolve: Resolver): Promise<{ address: string } | { error: SiteError }> {
  if (url.username || url.password || (url.port !== "" && url.port !== "443")) return { error: "blocked" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return isBlockedAddress(host) ? { error: "blocked" } : { address: host };
  if (isBlockedHostname(host)) return { error: "blocked" };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { error: "unreachable" };
  }
  if (addresses.length === 0) return { error: "unreachable" };
  if (addresses.some(isBlockedAddress)) return { error: "blocked" };
  return { address: addresses[0] };
}

const resolveHost: Resolver = async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

function decompress(res: Readable, encoding: string): Readable {
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** GET over https to the checked address; reads at most MAX_BYTES of decompressed HTML. */
const httpsGet: Getter = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const family = net.isIPv6(address) ? 6 : 4;
    const req = https.request(
      {
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en",
        },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status < 200 || status >= 300 || !/html/i.test(contentType)) {
          res.destroy();
          resolve({ status, location, contentType, body: "" });
          return;
        }
        const stream = decompress(res, String(res.headers["content-encoding"] ?? "").toLowerCase());
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          res.destroy();
          resolve({ status, location, contentType, body: new TextDecoder("utf-8").decode(Buffer.concat(chunks)) });
        };
        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          const room = MAX_BYTES - size;
          chunks.push(chunk.subarray(0, room));
          size += Math.min(chunk.length, room);
          if (size >= MAX_BYTES) finish();
        });
        stream.on("end", finish);
        stream.on("error", (error) => {
          if (done) return;
          done = true;
          reject(error);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  times: "×",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of tag.matchAll(re)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function metaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = clean(attrs.content);
  }
  return meta;
}

const HIDDEN = /<(script|style|noscript|svg|template|iframe|nav|footer|select|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

function cap(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.slice(0, MAX_TEXT + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, MAX_TEXT)).trim();
}

/** Title, description tags and visible text of an HTML page. */
export function extractSite(html: string, url: string): Site {
  const meta = metaTags(html);
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  const stripped = html.replace(/<!--[\s\S]*?-->/g, " ").replace(HIDDEN, " ");
  const mains = [...stripped.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/gi)].map((m) => m[1]);
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(stripped)?.[1] ?? stripped.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");
  const source = mains.length > 0 ? mains.join(" ") : body;
  return {
    url,
    title,
    description: meta.description ?? "",
    ogTitle: meta["og:title"] ?? "",
    ogDescription: meta["og:description"] ?? "",
    siteName: meta["og:site_name"] ?? "",
    text: cap(clean(source.replace(/<[^>]*>/g, " "))),
  };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "";
  }
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A brand name from og:site_name, the title segment matching the host, or the host itself. */
export function brandFromSite(site: Site): string {
  if (site.siteName) return site.siteName;
  const label = hostLabel(site.url);
  const segments = [site.ogTitle, site.title].flatMap((t) => t.split(/\s+[|–—·:-]\s+/)).map((s) => s.trim());
  const match = segments.find((s) => s && label && squash(s).includes(squash(label)));
  if (match) return match;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
}

async function follow(input: string, resolve: Resolver, get: Getter, signal: AbortSignal): Promise<SiteResult> {
  let url = parseHttps(input);
  if (!url) return { error: "invalid_url" };
  for (let redirects = 0; ; redirects++) {
    const target = await checkTarget(url, resolve);
    if ("error" in target) return target;
    let hop: Hop;
    try {
      hop = await get(url, target.address, signal);
    } catch {
      return { error: "unreachable" };
    }
    if (hop.status >= 300 && hop.status < 400 && hop.location) {
      if (redirects >= MAX_REDIRECTS) return { error: "too_many_redirects" };
      const next = parseHttps(hop.location, url);
      if (!next) return { error: "invalid_url" };
      url = next;
      continue;
    }
    if (hop.status < 200 || hop.status >= 300) return { error: "unreachable" };
    if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(hop.contentType)) return { error: "not_html" };
    const site = extractSite(hop.body, url.href);
    return site.text || site.description || site.ogDescription ? { site } : { error: "empty" };
  }
}

/** Reads a public https page: at most 3 redirects, 5 s and 1 MB, every hop checked against private addresses. */
export async function readSite(
  url: string,
  { resolve = resolveHost, get = httpsGet, timeoutMs = READ_TIMEOUT_MS }: ReadDeps = {},
): Promise<SiteResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SiteResult>((done) => {
    timer = setTimeout(() => {
      controller.abort();
      done({ error: "unreachable" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([follow(url, resolve, get, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
