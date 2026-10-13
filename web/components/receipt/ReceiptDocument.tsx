import type { CheckState, EventView, ReceiptView, SeenView, StepView, Tone } from "../../app/receipt/view-model";
import { shortAddress, shortHash } from "../../lib/format";
import { AriaEyebrow } from "../AriaBrand";
import CopyCommand from "./CopyCommand";

const TONE: Record<Tone, string> = {
  pending: "bg-sky-50 text-sky-800 ring-sky-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  bad: "bg-rose-50 text-rose-800 ring-rose-200",
};

const DOT: Record<Tone, string> = {
  pending: "bg-sky-500",
  warn: "bg-amber-500",
  good: "bg-emerald-500",
  bad: "bg-rose-500",
};

const CHECK_MARK: Record<CheckState, { mark: string; className: string }> = {
  pass: { mark: "✓", className: "bg-emerald-50 text-emerald-700" },
  fail: { mark: "✗", className: "bg-rose-50 text-rose-700" },
  unknown: { mark: "–", className: "bg-stone-100 text-stone-500" },
};

export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ${TONE[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-stone-200 pt-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{title}</h2>
        {aside && <div className="whitespace-nowrap text-xs text-stone-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-stone-300 underline-offset-4 transition hover:text-stone-900 hover:decoration-stone-500"
    >
      {children}
    </a>
  );
}

function Step({ step, last }: { step: StepView; last: boolean }) {
  const dot =
    step.state === "done"
      ? "bg-emerald-500 ring-emerald-100"
      : step.state === "failed"
        ? "bg-rose-500 ring-rose-100"
        : "bg-white ring-stone-300";
  const text = step.state === "pending" ? "text-stone-400" : step.state === "failed" ? "text-rose-700" : "text-stone-800";
  return (
    <li className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${dot}`} />
      <span className={`text-sm font-medium ${text}`}>{step.label}</span>
      {step.txUrl && (
        <a
          href={step.txUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
        >
          tx ↗
        </a>
      )}
      {!last && <span className="hidden h-px w-8 bg-stone-200 sm:block" aria-hidden />}
    </li>
  );
}

function EventLifecycle({ event }: { event: EventView }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-stone-600">
          <span className="font-medium text-stone-900">{event.kind}</span>
          <span className="mx-2 text-stone-300">·</span>
          {event.price} USDC
          <span className="mx-2 text-stone-300">·</span>
          <span className="font-mono text-xs text-stone-400">{shortHash(event.eventId)}</span>
        </div>
        <StatusPill tone={event.status.tone} label={event.status.label} />
      </div>
      {event.split && <p className="-mt-2 mb-4 text-sm text-stone-600">{event.split}</p>}
      <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {event.steps.map((step, i) => (
          <Step key={step.key} step={step} last={i === event.steps.length - 1} />
        ))}
      </ol>
    </div>
  );
}

const SEEN_STYLE: Record<SeenView["state"], { mark: string; box: string; markClass: string; title: string }> = {
  match: {
    mark: "✓",
    box: "bg-emerald-50 ring-emerald-200",
    markClass: "bg-emerald-600 text-white",
    title: "text-emerald-900",
  },
  mismatch: { mark: "✗", box: "bg-rose-50 ring-rose-200", markClass: "bg-rose-600 text-white", title: "text-rose-900" },
  absent: { mark: "–", box: "bg-stone-100/70 ring-stone-200", markClass: "bg-stone-300 text-white", title: "text-stone-700" },
};

/** Whether the card's sentence and claims are the ones logged on chain. */
export function SeenBanner({ seen }: { seen: SeenView }) {
  const style = SEEN_STYLE[seen.state];
  return (
    <div data-seen={seen.state} className={`flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ${style.box}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${style.markClass}`}
      >
        {style.mark}
      </span>
      <div className="space-y-1">
        <p className={`text-[15px] font-medium leading-snug ${style.title}`}>{seen.title}</p>
        <p className="text-sm leading-relaxed text-stone-600">{seen.detail}</p>
        {seen.differences.length > 0 && (
          <ul className="space-y-0.5 pt-1 font-mono text-xs text-rose-800">
            {seen.differences.map((d) => (
              <li key={d.label}>
                {d.label}: card {d.card} · logged {d.logged}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** `trust` is an optional footer line, rendered in place so it can stream in after the receipt. */
export default function ReceiptDocument({ view, trust }: { view: ReceiptView; trust?: React.ReactNode }) {
  return (
    <article className="space-y-10">
      <header className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <AriaEyebrow>receipt</AriaEyebrow>
            <p className="mt-1 font-mono text-sm text-stone-500">{view.requestId}</p>
          </div>
          <StatusPill tone={view.status.tone} label={view.status.label} />
        </div>

        <SeenBanner seen={view.seen} />

        <figure>
          <blockquote className="font-serif text-[1.75rem] leading-snug text-stone-900 sm:text-[2rem]">
            “{view.sentence}”
          </blockquote>
          <figcaption className="mt-4 text-sm text-stone-500">
            The sponsored sentence logged on Monad · {view.totalPrice} USDC · {view.status.note}
            {view.payment && <span className="mt-1 block text-stone-700">{view.payment}</span>}
          </figcaption>
        </figure>

        <p
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
            view.consistent ? "bg-stone-100 text-stone-700" : "bg-rose-50 text-rose-800"
          }`}
        >
          <span aria-hidden>{view.consistent ? "✓" : "✗"}</span>
          {view.consistent ? "Logged record is internally consistent" : "Logged record is not internally consistent"}
        </p>
      </header>

      <Section
        title="Advertiser's approved claims"
        aside={
          <ExternalLink href={view.advertiserUrl}>
            <span className="font-mono">{shortAddress(view.advertiser)}</span>
          </ExternalLink>
        }
      >
        {view.claims ? (
          <ol className="space-y-1.5">
            {view.claims.map((claim) => (
              <li
                key={claim.number}
                className={`flex gap-4 rounded-lg px-3 py-2 text-[15px] leading-relaxed ${
                  claim.cited ? "bg-amber-50 text-stone-900 ring-1 ring-amber-200" : "text-stone-500"
                }`}
              >
                <span className="w-4 shrink-0 font-mono text-sm text-stone-400">{claim.number}</span>
                <span className="flex-1">{claim.text}</span>
                {claim.cited && (
                  <span className="shrink-0 self-center text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                    cited
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-stone-500">The claims text was not found in the scanned blocks.</p>
        )}
      </Section>

      <Section title="Internal consistency" aside="recomputed from Monad's logs">
        <p className="mb-2 max-w-prose text-sm leading-relaxed text-stone-500">
          The contract computes these hashes itself when it logs, so they hold for any logged event. They show the
          record agrees with itself, not that it is what you saw; the line at the top checks that.
        </p>
        <ul className="divide-y divide-stone-100">
          {view.checks.map((check) => (
            <li key={check.key} className="flex items-start gap-4 py-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  CHECK_MARK[check.state].className
                }`}
              >
                {CHECK_MARK[check.state].mark}
              </span>
              <div>
                <p className="text-sm font-medium text-stone-900">{check.label}</p>
                <p className="font-mono text-xs leading-relaxed text-stone-500">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lifecycle" aside={view.lifecycleSummary}>
        <div className="space-y-3">
          {view.events.map((event) => (
            <EventLifecycle key={event.eventId} event={event} />
          ))}
        </div>
      </Section>

      <Section title="Verify it yourself">
        <CopyCommand command={view.verifyCommand} />
        <p className="mt-3 text-sm text-stone-500">
          Reads the contract over a public RPC. No Aria server involved. Add{" "}
          <code className="font-mono text-xs text-stone-700">--sentence &quot;&lt;text you saw&gt;&quot;</code> to check
          the sentence against the chain yourself.
        </p>
      </Section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-stone-200 pt-6 text-xs text-stone-500">
        <span>
          Contract{" "}
          <ExternalLink href={view.contractUrl}>
            <span className="font-mono">{shortAddress(view.contract)}</span>
          </ExternalLink>
        </span>
        <span>
          Campaign{" "}
          {view.campaignTxUrl ? (
            <ExternalLink href={view.campaignTxUrl}>
              <span className="font-mono">{shortHash(view.campaignId)}</span>
            </ExternalLink>
          ) : (
            <span className="font-mono">{shortHash(view.campaignId)}</span>
          )}
        </span>
        <span>Monad testnet</span>
        {trust}
      </footer>
    </article>
  );
}
