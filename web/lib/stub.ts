import type { Campaign } from "./campaigns";
import { MAX_RATIONALE } from "./pick";

// Keywords that signal buying intent for each demo campaign.
const KEYWORDS: Record<string, string[]> = {
  "lisbon-family-trips": ["lisbon", "algarve", "portugal", "family trip", "kids", "vacation", "holiday"],
  "agency-project-planner": ["project management", "agency", "client portal", "time tracking"],
  "alpine-hiking-gear": ["hiking", "hike", "boots", "backpack", "day pack", "trek"],
  "language-coach": ["learn a language", "language lessons", "tutor", "learn spanish", "learn italian"],
};

export const STUB_ANSWER =
  "This is the stub model: KIMI_API_KEY is not set, so Nova returns this fixed answer. " +
  "Set the key in the repo-root .env.local to get real answers from KIMI.";

/** Keyword pick: the first matching campaign, cited claims joined verbatim. */
export function stubPick(question: string, campaigns: Campaign[]) {
  const q = question.toLowerCase();
  const campaign = campaigns.find((c) => (KEYWORDS[c.slug] ?? []).some((k) => q.includes(k)));
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

/** Yields the fixed answer word by word, like a stream. */
export async function* stubAnswer(): AsyncGenerator<string> {
  for (const word of STUB_ANSWER.split(/(?<= )/)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    yield word;
  }
}
