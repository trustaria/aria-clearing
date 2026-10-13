import { allCampaigns } from "@/lib/campaigns";
import { geminiPicker } from "@/lib/serve/gemini";
import { handleServe } from "@/lib/serve/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aria's serve API: picks at most one live campaign with Gemini, or by keyword without a Gemini key. */
export async function POST(req: Request) {
  return handleServe(req, { picker: geminiPicker(), campaigns: allCampaigns() });
}
