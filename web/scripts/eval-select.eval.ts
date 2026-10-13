import { writeFileSync } from "node:fs";
import { RateLimitError } from "openai";
import { it } from "vitest";
import { campaigns } from "../lib/campaigns";
import { MAX_RATIONALE } from "../lib/pick";
import { GEMINI_TIMEOUT_MS, geminiModel, geminiPicker } from "../lib/serve/gemini";
import { selectAd } from "../lib/serve/select";
import { CASES, type EvalCase } from "./eval-select-cases";

// Runs each case through the serve API's Gemini selector against the live API and prints pick accuracy,
// latency and sentence stats. EVAL_RUNS (default 3), EVAL_ONLY (comma-separated id prefixes),
// EVAL_INTERVAL_MS (default 1000, spacing between call starts), EVAL_OUT (JSON results path).

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const INTERVAL_MS = Number(process.env.EVAL_INTERVAL_MS ?? 1000);
const ONLY = (process.env.EVAL_ONLY ?? "").split(",").filter(Boolean);
const CALL_TIMEOUT_MS = 20000;
const RATE_LIMIT_RETRIES = 4;

const INLINE_REF = /\(\s*\d+(\s*,\s*\d+)*\s*\)|\[\s*\d+\s*\]/;

type Row = {
  id: string;
  kind: EvalCase["kind"];
  expect: string[];
  run: number;
  ms: number;
  error?: string;
  rawSlug: string | null;
  slug: string | null;
  decision: string;
  sentence: string;
  claimRefs: unknown;
  refsInvalid: boolean;
  inlineRef: boolean;
};

let lastStart = 0;
let rateLimited = 0;

async function paced<T>(call: () => Promise<T>): Promise<T> {
  const wait = lastStart + INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastStart = Date.now();
  return call();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)} % (${n}/${d})`);

/** A paced Gemini call; a 429 waits for the next slot and retries, so latency covers one clean request. */
async function pacedPick(question: string) {
  const picker = geminiPicker({ timeoutMs: CALL_TIMEOUT_MS });
  if (!picker) throw new Error("GEMINI_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    try {
      return await paced(async () => {
        const start = Date.now();
        const raw = await picker({ prompt: question, campaigns });
        return { raw, ms: Date.now() - start };
      });
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= RATE_LIMIT_RETRIES) throw error;
      rateLimited++;
    }
  }
}

async function runPick(c: EvalCase, run: number): Promise<Row> {
  const start = Date.now();
  const base = { id: c.id, kind: c.kind, expect: c.expect, run };
  try {
    const { raw, ms } = await pacedPick(c.question);
    const r = (raw ?? {}) as Record<string, unknown>;
    const rawSlug = typeof r.slug === "string" ? r.slug : null;
    const campaign = campaigns.find((x) => x.slug === rawSlug);
    const refs = r.claimRefs;
    const refsInvalid =
      !!campaign &&
      (!Array.isArray(refs) ||
        refs.length === 0 ||
        refs.some((n) => !Number.isInteger(n) || n < 1 || n > campaign.claims.length));
    const sentence = typeof r.sentence === "string" ? r.sentence : "";
    const selection = await selectAd({ prompt: c.question, campaigns }, async () => raw);
    return {
      ...base,
      ms,
      rawSlug,
      slug: selection.decision === "served" ? selection.pick.slug : null,
      decision: selection.decision === "served" ? "served" : selection.reason,
      sentence,
      claimRefs: refs,
      refsInvalid,
      inlineRef: INLINE_REF.test(sentence),
    };
  } catch (error) {
    return {
      ...base,
      ms: Date.now() - start,
      error: (error as Error).message,
      rawSlug: null,
      slug: null,
      decision: "error",
      sentence: "",
      claimRefs: [],
      refsInvalid: false,
      inlineRef: false,
    };
  }
}

function report(rows: Row[]) {
  const ok = rows.filter((r) => !r.error);
  const commercial = ok.filter((r) => r.expect.length > 0);
  const nonCommercial = ok.filter((r) => r.expect.length === 0);
  const correct = commercial.filter((r) => r.slug && r.expect.includes(r.slug)).length;
  const falsePicks = nonCommercial.filter((r) => r.slug).length;
  const nulls = ok.filter((r) => !r.slug);
  const rightNulls = nulls.filter((r) => r.expect.length === 0).length;
  const picks = ok.filter((r) => r.rawSlug);
  const lengths = picks.map((r) => r.sentence.length);
  const latency = ok.map((r) => r.ms);

  console.log("\nPer case (served slug per run, - = no ad, ! = error):");
  for (const id of [...new Set(rows.map((r) => r.id))]) {
    const runs = rows.filter((r) => r.id === id);
    const marks = runs.map((r) => (r.error ? "!" : (r.slug ?? "-"))).join(" | ");
    const good = runs.every((r) => !r.error && (r.expect.length ? r.expect.includes(r.slug ?? "") : !r.slug));
    console.log(`${good ? " " : "x"} ${id.padEnd(26)} ${marks}`);
  }

  console.log("\nSentences:");
  for (const r of picks) console.log(`  [${r.sentence.length}] ${r.rawSlug} ${JSON.stringify(r.claimRefs)}: ${r.sentence}`);

  console.log(`\nGemini model ${geminiModel()}, ${rows.length} calls, ${rows.length - ok.length} errors, ${rateLimited} rate-limited retries`);
  for (const r of rows.filter((x) => x.error)) console.log(`  error ${r.id}#${r.run}: ${r.error}`);
  console.log(`Commercial picks correct  ${pct(correct, commercial.length)}`);
  console.log(`Non-commercial served     ${pct(falsePicks, nonCommercial.length)}`);
  console.log(`No-fill precision         ${pct(rightNulls, nulls.length)}`);
  console.log(`Latency p50 / p95 / max   ${percentile(latency, 50)} / ${percentile(latency, 95)} / ${Math.max(...latency)} ms`);
  console.log(`Within ${GEMINI_TIMEOUT_MS} ms timeout   ${pct(latency.filter((ms) => ms <= GEMINI_TIMEOUT_MS).length, latency.length)}`);
  console.log(
    `Sentence length           avg ${(lengths.reduce((s, n) => s + n, 0) / (lengths.length || 1)).toFixed(0)}, ` +
      `max ${Math.max(0, ...lengths)}, over ${MAX_RATIONALE}: ${lengths.filter((n) => n > MAX_RATIONALE).length}`,
  );
  console.log(`Invalid claimRefs         ${picks.filter((r) => r.refsInvalid).length} of ${picks.length} picks`);
  console.log(`Inline "(n)" markers      ${picks.filter((r) => r.inlineRef).length} of ${picks.length} picks`);
}

it("serve selector eval", async () => {
  const cases = CASES.filter((c) => ONLY.length === 0 || ONLY.some((prefix) => c.id.startsWith(prefix)));
  console.log(`${cases.length} cases x ${RUNS} runs, ${INTERVAL_MS} ms between calls`);
  const rows: Row[] = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const c of cases) {
      const row = await runPick(c, run);
      rows.push(row);
      const mark = row.error ? `error ${row.error}` : (row.slug ?? `- ${row.decision}`);
      console.log(`  ${run} ${c.id.padEnd(26)} ${String(row.ms).padStart(5)} ms  ${mark}`);
    }
  }
  report(rows);
  if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, JSON.stringify(rows, null, 2));
});
