import { draftClaims, type DraftInput } from "@/lib/claims-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftErrors = { brand?: string; url?: string; description?: string };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validate(body: unknown): { errors: DraftErrors; value?: DraftInput } {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const value = { brand: text(raw.brand), url: text(raw.url), description: text(raw.description) };

  const errors: DraftErrors = {};
  if (value.brand.length < 2 || value.brand.length > 40) errors.brand = "Brand name must be 2 to 40 characters.";
  if (!isHttpsUrl(value.url)) errors.url = "Website must be a valid https:// address.";
  if (value.description.length < 40 || value.description.length > 1500) {
    errors.description = "Description must be 40 to 1,500 characters.";
  }
  return Object.keys(errors).length > 0 ? { errors } : { errors, value };
}

/** Drafts claims for the advertiser wizard: the draft, or `{manual: true}`. */
export async function POST(req: Request) {
  const { errors, value } = validate(await req.json().catch(() => null));
  if (!value) return Response.json({ errors }, { status: 400 });
  return Response.json(await draftClaims(value));
}
