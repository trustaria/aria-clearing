// Validation rules and money copy for the campaign wizard. Amounts are whole cents.

export const CATEGORIES = [
  "travel",
  "software",
  "outdoor",
  "education",
  "food and drink",
  "home",
  "finance",
  "health",
  "retail",
  "other",
] as const;

export const BRAND_MIN = 2;
export const BRAND_MAX = 40;
export const DESCRIPTION_MIN = 40;
export const DESCRIPTION_MAX = 1500;
export const CLAIM_MIN = 10;
export const CLAIM_MAX = 120;
export const CLAIMS_MIN = 1;
export const CLAIMS_MAX = 5;
export const TOPICS_MAX = 6;
export const CPC_MIN_CENTS = 1;
export const CPC_MAX_CENTS = 500;
export const CPM_MIN_CENTS = 100;
export const CPM_MAX_CENTS = 5000;
export const BUDGET_MIN_CENTS = 100;
export const DEFAULT_BUDGET_CENTS = 500;
export const DEFAULT_CPC_CENTS = 25;
export const DEFAULT_CPM_CENTS = 1000;
export const BUDGET_PRESETS = [200, 500, 1000] as const;

export const DRAFT_FAILED = "We couldn't draft claims right now. Write 3 to 5 short facts about your product.";
export const LAUNCH_FAILED = "We couldn't launch right now. Nothing was charged. Try again in a minute.";
export const SITE_UNREADABLE = "We couldn't read that page. Describe what you sell below.";
export const SITE_DRAFT_FAILED = "We couldn't draft from your website right now. Describe what you sell below.";
export const SITE_DRAFTED = "Drafted by KIMI from your website — edit anything";

export type ProductInput = { brand: string; url: string; description: string };
export type ProductErrors = Partial<Record<keyof ProductInput, string>>;

/** Cents as dollars with two decimals, e.g. 500 → "$5.00". */
export function dollars(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
}

/** A dollar amount typed by the user as whole cents; null when it is not a number. */
export function parseDollars(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

function isHttpsUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Errors per Step 1 field; empty when every field is valid. */
export function validateProduct({ brand, url, description }: ProductInput): ProductErrors {
  const errors: ProductErrors = {};
  const b = brand.trim();
  const d = description.trim();
  if (b.length < BRAND_MIN || b.length > BRAND_MAX) errors.brand = `Use ${BRAND_MIN} to ${BRAND_MAX} characters.`;
  if (!isHttpsUrl(url)) errors.url = "Use a full link that starts with https://";
  if (d.length < DESCRIPTION_MIN) errors.description = `Add a little more: at least ${DESCRIPTION_MIN} characters.`;
  else if (d.length > DESCRIPTION_MAX) errors.description = `Keep it under ${DESCRIPTION_MAX.toLocaleString("en-US")} characters.`;
  return errors;
}

/** Host and path without the scheme, e.g. "crema.works/home-espresso". */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url.trim();
  }
}

/** Host only, e.g. "crema.works". */
export function displayHost(url: string): string {
  return displayUrl(url).split("/")[0];
}

/** The claim as saved: single spaces, no line breaks, no leading "1." or "2)" numbering, NFC. */
export function normalizeClaim(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d+[.)]\s*/, "")
    .normalize("NFC");
}

/** Error for one claim row, or null when it is fine. */
export function claimError(text: string): string | null {
  const length = normalizeClaim(text).length;
  if (length > CLAIM_MAX) return `Keep each claim to ${CLAIM_MAX} characters.`;
  if (length < CLAIM_MIN) return `Write at least ${CLAIM_MIN} characters.`;
  return null;
}

/** Error for the claims list as a whole, or null when it can be approved. */
export function claimsError(claims: string[]): string | null {
  const filled = claims.filter((c) => normalizeClaim(c) !== "");
  if (filled.length < CLAIMS_MIN) return "Add at least one claim.";
  if (filled.length > CLAIMS_MAX) return `Use at most ${CLAIMS_MAX} claims.`;
  return filled.some((c) => claimError(c)) ? "Fix the highlighted claims." : null;
}

/** Non-empty claims, normalized, in order. */
export function approvedClaims(claims: string[]): string[] {
  return claims.map(normalizeClaim).filter((c) => c !== "");
}

/** Budget error, or null; a budget above the test maximum gets the low-funds copy. */
export function budgetError(cents: number | null, maxBudgetCents: number): string | null {
  if (cents === null || cents < BUDGET_MIN_CENTS) return `Enter at least ${dollars(BUDGET_MIN_CENTS)}.`;
  if (cents > maxBudgetCents) {
    return `Test funds are low: up to ${dollars(maxBudgetCents)} is available right now. Lower your budget or try again later.`;
  }
  return null;
}

export function cpcError(cents: number | null): string | null {
  if (cents === null || cents < CPC_MIN_CENTS || cents > CPC_MAX_CENTS) {
    return `Set a price between ${dollars(CPC_MIN_CENTS)} and ${dollars(CPC_MAX_CENTS)}.`;
  }
  return null;
}

export function cpmError(cents: number | null): string | null {
  if (cents === null || cents < CPM_MIN_CENTS || cents > CPM_MAX_CENTS) {
    return `Set a price between ${dollars(CPM_MIN_CENTS)} and ${dollars(CPM_MAX_CENTS)}.`;
  }
  return null;
}

/** "Pays for up to N clicks or M impressions." at the given prices. */
export function budgetCopy(budgetCents: number, cpcCents: number, cpmCents: number): string {
  const clicks = cpcCents > 0 ? Math.floor(budgetCents / cpcCents) : 0;
  const impressions = cpmCents > 0 ? Math.floor((budgetCents * 1000) / cpmCents) : 0;
  const n = (v: number) => v.toLocaleString("en-US");
  return `Pays for up to ${n(clicks)} ${clicks === 1 ? "click" : "clicks"} or ${n(impressions)} ${impressions === 1 ? "impression" : "impressions"}.`;
}

/** Category label with a capital first letter, e.g. "Food and drink". */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export type SiteDraftFields = { brand: string; description: string; claims: string[]; category: string; keywords: string[] };
export type SitePrefill = { product: ProductInput; claims: string[]; category: string; keywords: string[] };

/** Step 1 fields and the Step 2–3 values from a website draft, kept within the wizard's limits. */
export function applySiteDraft(product: ProductInput, draft: SiteDraftFields): SitePrefill {
  const topics = draft.keywords.map((k) => k.replace(/\s+/g, " ").trim().toLowerCase()).filter((k) => k !== "");
  return {
    product: {
      brand: draft.brand.replace(/\s+/g, " ").trim().slice(0, BRAND_MAX),
      url: product.url.trim(),
      description: draft.description.trim().slice(0, DESCRIPTION_MAX),
    },
    claims: approvedClaims(draft.claims).slice(0, CLAIMS_MAX),
    category: (CATEGORIES as readonly string[]).includes(draft.category) ? draft.category : "other",
    keywords: [...new Set(topics)].slice(0, TOPICS_MAX),
  };
}

/** The Step 1 message for a website that could not be drafted from. */
export function siteFailedCopy(reason: string): string {
  return reason === "draft_failed" ? SITE_DRAFT_FAILED : SITE_UNREADABLE;
}

/** Claims 1–2 joined into one example sentence for the card preview. */
export function previewSentence(claims: string[]): string {
  return approvedClaims(claims)
    .slice(0, 2)
    .map((c) => (/[.!?]$/.test(c) ? c : `${c}.`))
    .join(" ");
}
