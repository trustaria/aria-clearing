import type { Campaign } from "./campaigns";
import { MAX_RATIONALE } from "./pick";

export const STUB_ANSWER =
  "This is the stub model: KIMI_API_KEY is not set, so Nova returns this fixed answer. " +
  "Set the key in the repo-root .env.local to get real answers from KIMI.";

/** Answer shown when KIMI cannot answer a turn; the card still comes from the keyword pick. */
export const FALLBACK_ANSWER =
  "Nova can't reach its language model right now, so there is no full answer this time. " +
  "Please ask again in a minute.";

export const KIMI_BUSY_NOTICE = "KIMI is busy — showing a fallback answer.";

export const KIMI_STOPPED_NOTICE = "KIMI stopped before finishing this answer.";

/** True when `keyword` appears in `text` as whole words, with an optional plural ending. */
function mentions(text: string, keyword: string): boolean {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?:s|es)?(?![a-z0-9])`).test(text);
}

/** Keyword pick: the campaign matching the most keywords (earlier wins a tie), cited claims joined verbatim. */
export function stubPick(question: string, campaigns: Campaign[]) {
  const q = question.toLowerCase();
  let campaign: Campaign | undefined;
  let best = 0;
  for (const c of campaigns) {
    const score = (c.keywords ?? []).filter((k) => mentions(q, k)).length;
    if (score > best) {
      best = score;
      campaign = c;
    }
  }
  if (!campaign) return { slug: null, rationale: "", claimRefs: [] };

  const claimRefs: number[] = [];
  let rationale = "";
  campaign.claims.forEach((claim, i) => {
    const next = rationale ? `${rationale} ${claim}` : claim;
    if (claimRefs.length < 2 && next.length <= MAX_RATIONALE) {
      rationale = next;
      claimRefs.push(i + 1);
    }
  });
  return { slug: campaign.slug, rationale, claimRefs };
}

/** Yields a fixed answer word by word, like a stream. */
export async function* stubAnswer(text: string = STUB_ANSWER): AsyncGenerator<string> {
  for (const word of text.split(/(?<= )/)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    yield word;
  }
}
