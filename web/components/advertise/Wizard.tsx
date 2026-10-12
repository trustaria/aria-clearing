"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdvertiseClient } from "../../lib/advertise-client";
import CardPreview from "./CardPreview";
import {
  BUDGET_PRESETS,
  CATEGORIES,
  CLAIM_MAX,
  CLAIMS_MAX,
  DEFAULT_BUDGET_CENTS,
  DEFAULT_CPC_CENTS,
  DEFAULT_CPM_CENTS,
  DRAFT_FAILED,
  LAUNCH_FAILED,
  TOPICS_MAX,
  approvedClaims,
  budgetCopy,
  budgetError,
  categoryLabel,
  claimError,
  claimsError,
  cpcError,
  cpmError,
  displayHost,
  displayUrl,
  dollars,
  normalizeClaim,
  parseDollars,
  validateProduct,
  type ProductInput,
} from "./rules";
import { FieldError, INPUT, LINK, PRIMARY, SECONDARY, inputBorder } from "./ui";

export type Step = 1 | 2 | 3 | 4;

export type WizardState = {
  product: ProductInput;
  claims: string[];
  category: string;
  keywords: string[];
  budget: number | "custom";
  customBudget: string;
  cpc: string;
  cpm: string;
};

const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: "Your product" },
  { step: 2, label: "Claims" },
  { step: 3, label: "Budget and bids" },
  { step: 4, label: "Review and launch" },
];

const EMPTY_ROWS = ["", "", ""];
const PROGRESS_MS = [400, 1200];

export const INITIAL_STATE: WizardState = {
  product: { brand: "", url: "", description: "" },
  claims: [],
  category: "other",
  keywords: [],
  budget: DEFAULT_BUDGET_CENTS,
  customBudget: "",
  cpc: (DEFAULT_CPC_CENTS / 100).toFixed(2),
  cpm: (DEFAULT_CPM_CENTS / 100).toFixed(2),
};

const CARD = "rounded-xl border border-stone-200 bg-white p-4 sm:p-6";
const H1 = "font-serif text-[1.75rem] leading-snug text-stone-900 sm:text-[2rem]";
const H2 = "font-serif text-[1.375rem] leading-snug text-stone-900";
const LABEL = "block text-sm font-medium text-stone-800";
const HELP = "text-sm leading-relaxed text-stone-500";

function budgetCents(state: WizardState): number | null {
  return state.budget === "custom" ? parseDollars(state.customBudget) : state.budget;
}

function productKey(p: ProductInput): string {
  return JSON.stringify([p.brand.trim(), p.url.trim(), p.description.trim()]);
}

/** One-line summaries of finished steps, shown in the rail. */
function summaries(state: WizardState): Record<Step, string> {
  const budget = budgetCents(state);
  return {
    1: `${state.product.brand.trim()} · ${displayHost(state.product.url)}`,
    2: `${approvedClaims(state.claims).length} approved`,
    3: `${budget === null ? "—" : dollars(budget)} · ${categoryLabel(state.category)}`,
    4: "",
  };
}

function Rail({ step, state, onGo }: { step: Step; state: WizardState; onGo: (s: Step) => void }) {
  const lines = summaries(state);
  return (
    <nav aria-label="Steps" className="hidden md:block">
      <ol className="sticky top-10 space-y-1 border-l border-stone-200">
        {STEPS.map(({ step: s, label }) => {
          const done = s < step;
          const current = s === step;
          return (
            <li key={s} className="-ml-px">
              <button
                type="button"
                onClick={() => done && onGo(s)}
                disabled={!done}
                aria-current={current ? "step" : undefined}
                className={`block w-full border-l-2 py-2 pl-4 pr-2 text-left ${current ? "border-stone-900" : "border-transparent"} ${done ? "cursor-pointer hover:bg-white/70" : "cursor-default"}`}
              >
                <span className={`flex items-center gap-2 text-sm ${current ? "font-medium text-stone-900" : done ? "text-stone-700" : "text-stone-400"}`}>
                  <span aria-hidden className={`w-3 text-center text-xs ${done ? "text-emerald-700" : ""}`}>
                    {done ? "✓" : current ? "●" : "○"}
                  </span>
                  {label}
                </span>
                {done && lines[s] && <span className="mt-0.5 block truncate pl-5 text-xs text-stone-500">{lines[s]}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-3 pt-2">{children}</div>;
}

function ProductStep({ product, onChange, onNext }: { product: ProductInput; onChange: (p: ProductInput) => void; onNext: () => void }) {
  const [touched, setTouched] = useState<Partial<Record<keyof ProductInput, boolean>>>({});
  const errors = validateProduct(product);
  const valid = Object.keys(errors).length === 0;
  const show = (field: keyof ProductInput) => (touched[field] ? errors[field] : undefined);
  const field = (name: keyof ProductInput) => ({
    id: `product-${name}`,
    value: product[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...product, [name]: e.target.value }),
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
    "aria-invalid": Boolean(show(name)),
    "aria-describedby": show(name) ? `product-${name}-error` : undefined,
    className: `${INPUT} ${inputBorder(Boolean(show(name)))}`,
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onNext();
      }}
    >
      <div className="space-y-2">
        <h1 className={H1}>Let&apos;s start with what you sell</h1>
        <p className={HELP}>The AI drafts your ad from this. You approve every word.</p>
      </div>
      <div className={`${CARD} space-y-5`}>
        <div className="space-y-1.5">
          <label htmlFor="product-brand" className={LABEL}>
            Brand name
          </label>
          <input {...field("brand")} placeholder="Crema Works" autoComplete="organization" />
          {show("brand") && <FieldError id="product-brand-error">{show("brand")}</FieldError>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="product-url" className={LABEL}>
            Where should people go after clicking?
          </label>
          <input {...field("url")} type="url" inputMode="url" placeholder="https://crema.works/home-espresso" autoComplete="url" />
          {show("url") && <FieldError id="product-url-error">{show("url")}</FieldError>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="product-description" className={LABEL}>
            Describe what you sell
          </label>
          <textarea {...field("description")} rows={5} placeholder="Compact espresso machines for home kitchens…" />
          {show("description") ? (
            <FieldError id="product-description-error">{show("description")}</FieldError>
          ) : (
            <p className={HELP}>A few sentences: what it is, who it is for, facts a buyer cares about.</p>
          )}
        </div>
      </div>
      <Actions>
        <button type="submit" disabled={!valid} className={PRIMARY}>
          Draft my claims
        </button>
      </Actions>
    </form>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-4 text-sm text-stone-300">{i + 1}</span>
          <div className="h-11 flex-1 animate-pulse rounded-lg bg-stone-100" />
        </div>
      ))}
      <p className="text-sm text-stone-500">Drafting from your description…</p>
    </div>
  );
}

function ClaimRow({
  index,
  value,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  canRemove: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const length = normalizeClaim(value).length;
  const error = length === 0 ? null : length > CLAIM_MAX || touched ? claimError(value) : null;
  const id = `claim-${index}`;
  const counter = length > CLAIM_MAX - 20 ? "visible" : "invisible group-focus-within:visible";
  return (
    <div className="group space-y-1">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-4 shrink-0 text-sm tabular-nums text-stone-500">
          {index + 1}
        </label>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="A short fact about your product"
          className={`${INPUT} ${inputBorder(Boolean(error))}`}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Remove claim ${index + 1}`}
          className="shrink-0 rounded-md px-2 py-1 text-stone-400 transition hover:text-stone-900 disabled:invisible"
        >
          ✕
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 pl-7 pr-9">
        <div>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</div>
        <span className={`text-xs tabular-nums ${counter} ${length > CLAIM_MAX ? "text-rose-700" : "text-stone-400"}`}>
          {length}/{CLAIM_MAX}
        </span>
      </div>
    </div>
  );
}

function ClaimsStep({
  brand,
  claims,
  drafting,
  draftFailed,
  onChange,
  onRedraft,
  onBack,
  onNext,
}: {
  brand: string;
  claims: string[];
  drafting: boolean;
  draftFailed: boolean;
  onChange: (claims: string[]) => void;
  onRedraft: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const error = drafting ? "drafting" : claimsError(claims);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={H1}>Approve what the AI may say about you</h1>
        <p className={HELP}>
          Each sponsored sentence is written only from these claims and cites them by number. You approve the exact text.
        </p>
      </div>
      {draftFailed && !drafting && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {DRAFT_FAILED}
        </p>
      )}
      <div className={`${CARD} space-y-3`}>
        {drafting ? (
          <SkeletonRows />
        ) : (
          <>
            {claims.map((claim, i) => (
              <ClaimRow
                key={i}
                index={i}
                value={claim}
                canRemove={claims.length > 1}
                onChange={(v) => onChange(claims.map((c, j) => (j === i ? v : c)))}
                onRemove={() => onChange(claims.filter((_, j) => j !== i))}
              />
            ))}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {claims.length < CLAIMS_MAX && (
                <button type="button" onClick={() => onChange([...claims, ""])} className="text-sm font-medium text-stone-700 hover:text-stone-900">
                  + Add a claim
                </button>
              )}
              <button type="button" onClick={onRedraft} className="text-sm font-medium text-stone-700 hover:text-stone-900">
                ↻ Redraft
              </button>
            </div>
          </>
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Preview</h2>
        {drafting ? (
          <div className="h-28 animate-pulse rounded-xl border border-stone-200 bg-white" />
        ) : (
          <CardPreview brand={brand} claims={claims} />
        )}
        <p className={HELP}>Example only: the real sentence is written per question.</p>
        <p className={HELP}>Keep claims factual: no prices you might change, no &ldquo;best&rdquo;, no comparisons.</p>
      </div>
      <Actions>
        <button type="button" onClick={onBack} className={SECONDARY}>
          Back
        </button>
        <button type="button" onClick={onNext} disabled={Boolean(error)} className={PRIMARY}>
          Approve claims
        </button>
      </Actions>
    </div>
  );
}

function Topics({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const add = () => {
    const topic = draft.replace(/\s+/g, " ").trim().toLowerCase();
    if (topic && !keywords.includes(topic) && keywords.length < TOPICS_MAX) onChange([...keywords, topic]);
    setDraft("");
    setAdding(false);
  };
  return (
    <div className="space-y-2">
      <p className={LABEL}>Topics (optional)</p>
      <div className="flex flex-wrap items-center gap-2">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 py-1 pl-3 pr-1.5 text-sm text-stone-700">
            {k}
            <button
              type="button"
              onClick={() => onChange(keywords.filter((x) => x !== k))}
              aria-label={`Remove ${k}`}
              className="rounded-full px-1 text-stone-400 hover:text-stone-900"
            >
              ✕
            </button>
          </span>
        ))}
        {keywords.length < TOPICS_MAX &&
          (adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={add}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              maxLength={40}
              aria-label="New topic"
              placeholder="e.g. espresso grinder"
              className="w-44 rounded-full border border-stone-300 bg-white px-3 py-1 text-sm focus:border-stone-500 focus:outline-none"
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-dashed border-stone-300 px-3 py-1 text-sm text-stone-600 hover:text-stone-900">
              + Add
            </button>
          ))}
      </div>
    </div>
  );
}

function BudgetOption({
  checked,
  onSelect,
  children,
  detail,
  radioOffset = "mt-1",
}: {
  radioOffset?: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3.5 transition ${checked ? "border-stone-900 ring-1 ring-stone-900" : "border-stone-200 hover:border-stone-300"}`}
    >
      <input type="radio" name="budget" checked={checked} onChange={onSelect} className={`${radioOffset} shrink-0 accent-stone-900`} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</span>
        {detail}
      </span>
    </label>
  );
}

function MoneyInput({ id, value, onChange, invalid, label }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; label: string }) {
  return (
    <div className="relative w-28 shrink-0">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-stone-500">$</span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        className={`${INPUT} ${inputBorder(invalid)} pl-6 text-right tabular-nums`}
      />
    </div>
  );
}

function BudgetStep({
  state,
  maxBudget,
  onChange,
  onBack,
  onNext,
}: {
  state: WizardState;
  maxBudget: number | null;
  onChange: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const cents = budgetCents(state);
  const cpc = parseDollars(state.cpc);
  const cpm = parseDollars(state.cpm);
  const budgetErr = budgetError(cents, maxBudget ?? Number.MAX_SAFE_INTEGER);
  const cpcErr = cpcError(cpc);
  const cpmErr = cpmError(cpm);
  const showCustomErr = state.budget === "custom" && state.customBudget.trim() === "" ? null : budgetErr;
  const pays = cents !== null && cpc && cpm && !cpcErr && !cpmErr ? budgetCopy(cents, cpc, cpm) : null;
  const paysLine = pays && <span className="block text-sm text-stone-500">{pays}</span>;

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <h1 className={H1}>Where should your ad appear?</h1>
        <div className={`${CARD} space-y-5`}>
          <div className="space-y-1.5">
            <label htmlFor="category" className={LABEL}>
              Category
            </label>
            <select
              id="category"
              value={state.category}
              onChange={(e) => onChange({ category: e.target.value })}
              className={`${INPUT} ${inputBorder(false)} sm:w-64`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <Topics keywords={state.keywords} onChange={(keywords) => onChange({ keywords })} />
          <p className={HELP}>
            The AI shows your ad only when a question is about buying something your claims describe. No personal data is
            used.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className={H2}>How much do you want to spend in total?</h2>
        <div className="space-y-2.5" role="radiogroup" aria-label="Total budget">
          {BUDGET_PRESETS.map((preset) => {
            const checked = state.budget === preset;
            return (
              <BudgetOption
                key={preset}
                checked={checked}
                onSelect={() => onChange({ budget: preset })}
                detail={checked && paysLine}
              >
                <span className="text-[15px] font-semibold tabular-nums text-stone-900">{dollars(preset)}</span>
                {preset === DEFAULT_BUDGET_CENTS && (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Recommended</span>
                )}
              </BudgetOption>
            );
          })}
          <BudgetOption
            checked={state.budget === "custom"}
            onSelect={() => onChange({ budget: "custom" })}
            radioOffset="mt-4"
            detail={
              <>
                {state.budget === "custom" && paysLine}
                {maxBudget !== null && <span className="block text-sm text-stone-500">Up to {dollars(maxBudget)} available in test mode.</span>}
              </>
            }
          >
            <span className="text-[15px] font-semibold text-stone-900">Custom</span>
            <MoneyInput
              id="custom-budget"
              label="Custom budget in dollars"
              value={state.customBudget}
              invalid={state.budget === "custom" && Boolean(showCustomErr)}
              onChange={(v) => onChange({ budget: "custom", customBudget: v })}
            />
          </BudgetOption>
        </div>
        {(state.budget !== "custom" ? budgetErr : showCustomErr) && <FieldError>{state.budget !== "custom" ? budgetErr : showCustomErr}</FieldError>}
      </section>

      <section className="space-y-4">
        <h2 className={H2}>What you pay</h2>
        <div className={`${CARD} space-y-4`}>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="cpc" className="text-[15px] text-stone-800">
                Cost per click (CPC)
              </label>
              <MoneyInput id="cpc" label="Cost per click in dollars" value={state.cpc} invalid={Boolean(cpcErr)} onChange={(v) => onChange({ cpc: v })} />
            </div>
            {cpcErr && <FieldError>{cpcErr}</FieldError>}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="cpm" className="text-[15px] text-stone-800">
                Cost per 1,000 impressions (CPM)
              </label>
              <MoneyInput id="cpm" label="Cost per 1,000 impressions in dollars" value={state.cpm} invalid={Boolean(cpmErr)} onChange={(v) => onChange({ cpm: v })} />
            </div>
            {cpmErr && <FieldError>{cpmErr}</FieldError>}
          </div>
          <p className={HELP}>
            You pay these exact prices, and only for impressions and clicks that pass verification. Rejected ones go back to
            your budget.
          </p>
        </div>
      </section>

      <Actions>
        <button type="button" onClick={onBack} className={SECONDARY}>
          Back
        </button>
        <button type="button" onClick={onNext} disabled={Boolean(budgetErr || cpcErr || cpmErr)} className={PRIMARY}>
          Next
        </button>
      </Actions>
    </div>
  );
}

export type Progress = { saved: boolean; held: boolean; live: boolean };

function ProgressLine({ done, active, children }: { done: boolean; active: boolean; children: React.ReactNode }) {
  if (!done && !active) return null;
  return (
    <li className={`flex items-center gap-2 text-sm ${done ? "text-stone-700" : "text-stone-900"}`}>
      <span aria-hidden className={`w-3 text-center text-xs ${done ? "text-emerald-700" : "animate-pulse text-stone-900"}`}>
        {done ? "✓" : "●"}
      </span>
      {children}
    </li>
  );
}

/** Test funding notice, launch buttons and launch progress. The buttons stay disabled while submitting. */
export function LaunchPanel({
  budgetCents,
  submitting,
  progress,
  error,
  onBack,
  onLaunch,
}: {
  budgetCents: number;
  submitting: boolean;
  progress: Progress | null;
  error: string | null;
  onBack: () => void;
  onLaunch: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className={HELP}>
        Once launched, claims and prices can&apos;t be edited. To change them, end the campaign and create a new one.
      </p>
      <div className="rounded-xl border border-stone-300 bg-stone-50 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Test funding</p>
        <p className="mt-2 text-[15px] leading-relaxed text-stone-800">
          This is a test network. No card is charged. Aria funds your {dollars(budgetCents)} budget with test dollars and
          holds it for this campaign.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      <Actions>
        <button type="button" onClick={onBack} disabled={submitting} className={SECONDARY}>
          Back
        </button>
        <button type="button" onClick={onLaunch} disabled={submitting} aria-busy={submitting} className={PRIMARY}>
          Fund and launch
        </button>
      </Actions>
      {progress && (
        <ul className="space-y-1.5" aria-live="polite">
          <ProgressLine done={progress.saved} active>
            Approved claims saved
          </ProgressLine>
          <ProgressLine done={progress.held} active={progress.saved}>
            {dollars(budgetCents)} held for your campaign
          </ProgressLine>
          <ProgressLine done={progress.live} active={progress.held}>
            {progress.live ? "Available to AI answers" : "Making it available to AI answers…"}
          </ProgressLine>
        </ul>
      )}
    </div>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-stone-100 py-3 first:border-t-0 sm:grid-cols-[7rem_1fr_auto]">
      <dt className="text-sm text-stone-500 sm:pt-0.5">{label}</dt>
      <dd className="col-span-2 row-start-2 min-w-0 text-[15px] leading-relaxed text-stone-800 [overflow-wrap:anywhere] sm:col-span-1 sm:row-start-auto">
        {children}
      </dd>
      {onEdit && (
        <button type="button" onClick={onEdit} className={`${LINK} col-start-2 row-start-1 self-start sm:col-start-auto sm:row-start-auto`}>
          Edit<span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      )}
    </div>
  );
}

function ReviewStep({
  state,
  locked,
  launch,
  onGo,
}: {
  state: WizardState;
  locked: boolean;
  launch: React.ReactNode;
  onGo: (s: Step) => void;
}) {
  const claims = approvedClaims(state.claims);
  const budget = budgetCents(state) ?? 0;
  const edit = (s: Step) => (locked ? undefined : () => onGo(s));
  const topics = state.keywords.length;
  return (
    <div className="space-y-6">
      <h1 className={H1}>Review and launch</h1>
      <dl className={CARD}>
        <ReviewRow label="Product" onEdit={edit(1)}>
          {state.product.brand.trim()} · {displayUrl(state.product.url)}
        </ReviewRow>
        <ReviewRow label="Claims" onEdit={edit(2)}>
          <ol className="space-y-1">
            {claims.map((c, i) => (
              <li key={i}>
                {i + 1}. {c}
              </li>
            ))}
          </ol>
        </ReviewRow>
        <ReviewRow label="Targeting" onEdit={edit(3)}>
          {categoryLabel(state.category)}
          {topics > 0 && ` · ${topics} ${topics === 1 ? "topic" : "topics"}`}
        </ReviewRow>
        <ReviewRow label="Budget" onEdit={edit(3)}>
          {dollars(budget)} total · CPC {dollars(parseDollars(state.cpc) ?? 0)} · CPM {dollars(parseDollars(state.cpm) ?? 0)}
        </ReviewRow>
      </dl>
      {launch}
    </div>
  );
}

/** Four-step campaign wizard. State lives here until launch; the client talks to /api/advertise/*. */
export default function Wizard({
  client,
  initialStep = 1,
  initialState,
  onLaunched,
}: {
  client: AdvertiseClient;
  initialStep?: Step;
  initialState?: Partial<WizardState>;
  onLaunched: (slug: string) => void;
}) {
  const [step, setStep] = useState<Step>(initialStep);
  const [state, setState] = useState<WizardState>({ ...INITIAL_STATE, ...initialState });
  const [maxBudget, setMaxBudget] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const draftedFor = useRef<string | null>(initialState?.claims?.length ? productKey({ ...INITIAL_STATE.product, ...initialState.product }) : null);
  const draftSeq = useRef(0);
  const launching = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    client
      .listCampaigns()
      .then((r) => live && setMaxBudget(r.maxBudget))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client]);

  const go = useCallback((s: Step) => {
    setStep(s);
    top.current?.scrollIntoView({ block: "start" });
  }, []);

  const patch = useCallback((p: Partial<WizardState>) => setState((s) => ({ ...s, ...p })), []);

  const draft = useCallback(async () => {
    const seq = ++draftSeq.current;
    const product = state.product;
    draftedFor.current = productKey(product);
    setDrafting(true);
    setDraftFailed(false);
    const result = await client.draft({
      brand: product.brand.trim(),
      url: product.url.trim(),
      description: product.description.trim(),
    }).catch(() => ({ manual: true }) as const);
    if (seq !== draftSeq.current) return;
    if ("manual" in result) {
      setDraftFailed(true);
      setState((s) => ({ ...s, claims: [...EMPTY_ROWS] }));
    } else {
      const category = (CATEGORIES as readonly string[]).includes(result.category) ? result.category : "other";
      setState((s) => ({
        ...s,
        claims: result.claims.slice(0, CLAIMS_MAX),
        category,
        keywords: result.keywords.slice(0, TOPICS_MAX),
      }));
    }
    setDrafting(false);
  }, [client, state.product]);

  const toClaims = () => {
    go(2);
    if (draftedFor.current !== productKey(state.product)) void draft();
  };

  const launch = async () => {
    if (launching.current) return;
    launching.current = true;
    setSubmitting(true);
    setLaunchError(null);
    setProgress({ saved: false, held: false, live: false });
    const timers = [
      setTimeout(() => setProgress((p) => p && { ...p, saved: true }), PROGRESS_MS[0]),
      setTimeout(() => setProgress((p) => p && { ...p, held: true }), PROGRESS_MS[1]),
    ];
    const result = await client
      .launch({
        brand: state.product.brand.trim(),
        url: state.product.url.trim(),
        description: state.product.description.trim(),
        claims: approvedClaims(state.claims),
        category: state.category,
        keywords: state.keywords,
        budgetCents: budgetCents(state) ?? 0,
        cpcCents: parseDollars(state.cpc) ?? 0,
        cpmCents: parseDollars(state.cpm) ?? 0,
      })
      .catch(() => ({ error: "" }));
    timers.forEach(clearTimeout);
    if ("slug" in result) {
      setProgress({ saved: true, held: true, live: true });
      onLaunched(result.slug);
      return;
    }
    setProgress(null);
    setLaunchError(result.error.startsWith("Test funds are low") ? result.error : LAUNCH_FAILED);
    setSubmitting(false);
    launching.current = false;
  };

  const budget = budgetCents(state) ?? 0;

  return (
    <div ref={top} className="grid scroll-mt-6 gap-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-12">
      <Rail step={step} state={state} onGo={(s) => !submitting && go(s)} />
      <div className="min-w-0 max-w-xl space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-500 md:hidden">Step {step} of 4</p>
        {step === 1 && <ProductStep product={state.product} onChange={(product) => patch({ product })} onNext={toClaims} />}
        {step === 2 && (
          <ClaimsStep
            brand={state.product.brand}
            claims={state.claims}
            drafting={drafting}
            draftFailed={draftFailed}
            onChange={(claims) => patch({ claims })}
            onRedraft={() => void draft()}
            onBack={() => go(1)}
            onNext={() => {
              patch({ claims: approvedClaims(state.claims) });
              go(3);
            }}
          />
        )}
        {step === 3 && <BudgetStep state={state} maxBudget={maxBudget} onChange={patch} onBack={() => go(2)} onNext={() => go(4)} />}
        {step === 4 && (
          <ReviewStep
            state={state}
            locked={submitting}
            onGo={go}
            launch={
              <LaunchPanel
                budgetCents={budget}
                submitting={submitting}
                progress={progress}
                error={launchError}
                onBack={() => go(3)}
                onLaunch={() => void launch()}
              />
            }
          />
        )}
      </div>
    </div>
  );
}

