import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { campaigns } from "../lib/campaigns";
import { kimiModel, requestPick, streamAnswer, type PickReply } from "../lib/kimi";
import { MAX_RATIONALE, PICK_DEADLINE_MS, validatePick } from "../lib/pick";
import { CASES, type EvalCase } from "./eval-kimi-cases";

// Runs each case against the live KIMI API and prints pick accuracy, latency, rationale and token stats.
// EVAL_RUNS (default 3), EVAL_ONLY (comma-separated id prefixes), EVAL_INTERVAL_MS (default 21000,
// spacing between call starts to stay under the account's requests-per-minute limit),
// EVAL_ANSWERS=1 (also time the streamed answers for the chips), EVAL_OUT (JSON results path).

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const INTERVAL_MS = Number(process.env.EVAL_INTERVAL_MS ?? 21000);
const ONLY = (process.env.EVAL_ONLY ?? "").split(",").filter(Boolean);
const CALL_TIMEOUT_MS = 20000;

// USD per 1M tokens for kimi-k2.6 (platform.kimi.ai pricing page).
const PRICE_INPUT = 0.95;
const PRICE_INPUT_CACHED = 0.16;
const PRICE_OUTPUT = 4;

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
  rationale: string;
  claimRefs: unknown;
  refsInvalid: boolean;
  inlineRef: boolean;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
};

let lastStart = 0;

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

function cachedOf(usage: PickReply["usage"]): number {
  const u = usage as (PickReply["usage"] & { cached_tokens?: number }) | undefined;
  return u?.prompt_tokens_details?.cached_tokens ?? u?.cached_tokens ?? 0;
}

async function runPick(c: EvalCase, run: number): Promise<Row> {
  const start = Date.now();
  const base = { id: c.id, kind: c.kind, expect: c.expect, run };
  try {
    const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
    const { raw, usage } = await requestPick(c.question, campaigns, signal);
    const ms = Date.now() - start;
    const r = (raw ?? {}) as Record<string, unknown>;
    const rawSlug = typeof r.slug === "string" ? r.slug : null;
    const campaign = campaigns.find((x) => x.slug === rawSlug);
    const refs = r.claimRefs;
    const refsInvalid =
      !!campaign &&
      (!Array.isArray(refs) ||
        refs.length === 0 ||
        refs.some((n) => !Number.isInteger(n) || n < 1 || n > campaign.claims.length));
    const rationale = typeof r.rationale === "string" ? r.rationale : "";
    return {
      ...base,
      ms,
      rawSlug,
      slug: validatePick(raw, campaigns)?.slug ?? null,
      rationale,
      claimRefs: refs,
      refsInvalid,
      inlineRef: INLINE_REF.test(rationale),
      promptTokens: usage?.prompt_tokens ?? 0,
      cachedTokens: cachedOf(usage),
      completionTokens: usage?.completion_tokens ?? 0,
    };
  } catch (error) {
    return {
      ...base,
      ms: Date.now() - start,
      error: (error as Error).message,
      rawSlug: null,
      slug: null,
      rationale: "",
      claimRefs: [],
      refsInvalid: false,
      inlineRef: false,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
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
  const lengths = picks.map((r) => r.rationale.length);
  const latency = ok.map((r) => r.ms);
  const prompt = ok.reduce((s, r) => s + r.promptTokens, 0);
  const cached = ok.reduce((s, r) => s + r.cachedTokens, 0);
  const completion = ok.reduce((s, r) => s + r.completionTokens, 0);
  const cost = ((prompt - cached) * PRICE_INPUT + cached * PRICE_INPUT_CACHED + completion * PRICE_OUTPUT) / 1e6;

  console.log("\nPer case (picked slug per run, - = no card, ! = error):");
  for (const id of [...new Set(rows.map((r) => r.id))]) {
    const runs = rows.filter((r) => r.id === id);
    const marks = runs.map((r) => (r.error ? "!" : (r.slug ?? "-"))).join(" | ");
    const good = runs.every((r) => !r.error && (r.expect.length ? r.expect.includes(r.slug ?? "") : !r.slug));
    console.log(`${good ? " " : "x"} ${id.padEnd(26)} ${marks}`);
  }

  console.log("\nRationales:");
  for (const r of picks) console.log(`  [${r.rationale.length}] ${r.rawSlug} ${JSON.stringify(r.claimRefs)}: ${r.rationale}`);

  console.log(`\nKIMI model ${kimiModel()}, ${rows.length} calls, ${rows.length - ok.length} errors`);
  for (const r of rows.filter((x) => x.error)) console.log(`  error ${r.id}#${r.run}: ${r.error}`);
  console.log(`Commercial picks correct  ${pct(correct, commercial.length)}`);
  console.log(`Non-commercial picked     ${pct(falsePicks, nonCommercial.length)}`);
  console.log(`Null precision            ${pct(rightNulls, nulls.length)}`);
  console.log(`Latency p50 / p95 / max   ${percentile(latency, 50)} / ${percentile(latency, 95)} / ${Math.max(...latency)} ms`);
  console.log(`Within ${PICK_DEADLINE_MS} ms deadline   ${pct(latency.filter((ms) => ms <= PICK_DEADLINE_MS).length, latency.length)}`);
  console.log(
    `Rationale length          avg ${(lengths.reduce((s, n) => s + n, 0) / (lengths.length || 1)).toFixed(0)}, ` +
      `max ${Math.max(0, ...lengths)}, over ${MAX_RATIONALE}: ${lengths.filter((n) => n > MAX_RATIONALE).length}`,
  );
  console.log(`Invalid claimRefs         ${picks.filter((r) => r.refsInvalid).length} of ${picks.length} picks`);
  console.log(`Inline "(n)" markers      ${picks.filter((r) => r.inlineRef).length} of ${picks.length} picks`);
  console.log(
    `Tokens per pick           ${(prompt / (ok.length || 1)).toFixed(0)} in (${cached} cached total), ` +
      `${(completion / (ok.length || 1)).toFixed(0)} out`,
  );
  console.log(`Cost                      $${cost.toFixed(4)} total, $${(cost / (ok.length || 1)).toFixed(5)} per pick`);
}

async function timeAnswers(cases: EvalCase[]) {
  console.log("\nAnswers (first text / full answer, words):");
  for (const c of cases.filter((x) => x.kind === "chip")) {
    await paced(async () => {
      const start = Date.now();
      let first = 0;
      let text = "";
      try {
        const messages = [{ role: "user" as const, content: c.question }];
        for await (const delta of streamAnswer("kimi", messages, AbortSignal.timeout(CALL_TIMEOUT_MS))) {
          if (!first) first = Date.now() - start;
          text += delta;
        }
        const words = text.split(/\s+/).filter(Boolean).length;
        console.log(`  ${c.id.padEnd(14)} ${first} ms / ${Date.now() - start} ms, ${words} words`);
      } catch (error) {
        console.log(`  ${c.id.padEnd(14)} error: ${(error as Error).message}`);
      }
    });
  }
}

it("KIMI pick eval", async () => {
  const cases = CASES.filter((c) => ONLY.length === 0 || ONLY.some((prefix) => c.id.startsWith(prefix)));
  console.log(`${cases.length} cases x ${RUNS} runs, ${INTERVAL_MS} ms between calls`);
  const rows: Row[] = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const c of cases) {
      const row = await paced(() => runPick(c, run));
      rows.push(row);
      const mark = row.error ? `error ${row.error}` : (row.slug ?? "-");
      console.log(`  ${run} ${c.id.padEnd(26)} ${String(row.ms).padStart(5)} ms  ${mark}`);
    }
  }
  report(rows);
  if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, JSON.stringify(rows, null, 2));
  if (process.env.EVAL_ANSWERS === "1") await timeAnswers(cases);
});
