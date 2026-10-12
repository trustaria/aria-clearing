import { verifyAdvertiser } from "@/lib/advertiser-auth";
import { BRAND_MAX, BRAND_MIN, draftClaims, draftFromSite, type DraftInput } from "@/lib/claims-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftErrors = { brand?: string; url?: string; description?: string };

type Validated =
  | { errors: DraftErrors }
  | { errors: DraftErrors; site: { url: string; brand?: string } }
  | { errors: DraftErrors; value: DraftInput };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const validBrand = (brand: string) => brand.length >= BRAND_MIN && brand.length <= BRAND_MAX;

/** With a description: a claims draft from it. Without one: a full draft from the website. */
function validate(body: unknown): Validated {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const value = { brand: text(raw.brand), url: text(raw.url), description: text(raw.description) };

  const errors: DraftErrors = {};
  if (!isHttpsUrl(value.url)) errors.url = "Website must be a valid https:// address.";
  if (!value.description) {
    if (errors.url) return { errors };
    return { errors, site: { url: value.url, brand: validBrand(value.brand) ? value.brand : undefined } };
  }
  if (!validBrand(value.brand)) errors.brand = "Brand name must be 2 to 40 characters.";
  if (value.description.length < 40 || value.description.length > 1500) {
    errors.description = "Description must be 40 to 1,500 characters.";
  }
  return Object.keys(errors).length > 0 ? { errors } : { errors, value };
}

/** Drafts for the signed-in advertiser: the draft, or `{manual: true}` (with a `reason` for website drafts). */
export async function POST(req: Request) {
  const advertiser = await verifyAdvertiser(req);
  if (advertiser instanceof Response) return advertiser;
  const result = validate(await req.json().catch(() => null));
  if ("site" in result) return Response.json(await draftFromSite(result.site.url, { brand: result.site.brand }));
  if ("value" in result) return Response.json(await draftClaims(result.value));
  return Response.json({ errors: result.errors }, { status: 400 });
}
