import Image from "next/image";
import Link from "next/link";
import { REPO_URL } from "../../lib/demo-nav";
import { proofLinks } from "../../lib/landing";
import { AriaLogo } from "../AriaBrand";
import ExternalLink from "../ExternalLink";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900";
const BUTTON = `inline-flex items-center justify-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 ${FOCUS}`;
const TEXT_LINK = `rounded font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 transition hover:decoration-stone-700 ${FOCUS}`;
const HEADING = "text-xs font-semibold uppercase tracking-[0.18em] text-stone-500";

const ROLES = [
  {
    kicker: "The AI app",
    title: "AI chat",
    body: "A demo AI app (Nova) that earns from sponsored answers. Ask a buying question.",
    href: "/ai-chat",
    action: "Open the AI chat",
    icon: "nova",
  },
  {
    kicker: "Aria for publishers",
    title: "Publisher dashboard",
    body: "What the AI app earns, verified and paid automatically. Sign in with any email.",
    href: "/dashboard",
    action: "Open the dashboard",
    icon: "aria",
  },
  {
    kicker: "Aria for advertisers",
    title: "Advertiser console",
    body: "Launch a campaign: KIMI drafts claims from your website, your wallet funds the escrow. Sign in with any email; test funds are added for you.",
    href: "/advertise",
    action: "Open the console",
    icon: "aria",
  },
] as const;

const SPONSORS = [
  { name: "Monad", role: "escrow, receipts and settlement" },
  { name: "Chainlink CRE", role: "verifies the evidence and settles each event" },
  { name: "Privy", role: "email sign-in, embedded wallets, server wallets with policies" },
  { name: "Envio", role: "indexes the dashboard and campaign pages" },
  { name: "KIMI", role: "the AI chat's answers and advertiser claim drafts" },
  { name: "Gemini", role: "Aria's ad selection" },
];

function RoleIcon({ icon }: { icon: "nova" | "aria" }) {
  if (icon === "aria") return <AriaLogo className="h-7 w-7" />;
  return <Image src="/icons/nova.svg" alt="" width={28} height={28} unoptimized />;
}

/** Demo overview. `recentReceipt` is a list item (or nothing) placed first in the proof list. */
export default function Landing({
  contract,
  envioUrl,
  recentReceipt,
}: {
  contract: string;
  envioUrl: string | null;
  recentReceipt: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <header className="max-w-3xl space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <AriaLogo className="h-6 w-6" />
            Aria Clearing · hackathon demo
          </p>
          <h1 className="font-serif text-[1.75rem] leading-snug sm:text-[2.1rem]">
            Clearing for sponsored AI answers: every sponsored line has a receipt, verified by Chainlink, settled on
            Monad.
          </h1>
          <p className="text-[15px] leading-relaxed text-stone-600">
            Nova is a separate AI app that shows Aria&apos;s sponsored lines through Aria&apos;s SDK. Aria is the ad
            network: the publisher dashboard, the advertiser console, the receipts and the clearing.
          </p>
        </header>

        <section aria-labelledby="roles" className="mt-7">
          <h2 id="roles" className="sr-only">
            Try the three roles
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {ROLES.map((role) => (
              <li key={role.href} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <RoleIcon icon={role.icon} />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{role.kicker}</p>
                    <h3 className="text-base font-semibold">{role.title}</h3>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-stone-600">{role.body}</p>
                <Link href={role.href} className={`${BUTTON} mt-4 self-start`}>
                  {role.action} <span aria-hidden className="ml-1">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_0.85fr_1fr]">
          <section aria-labelledby="start-here">
            <h2 id="start-here" className={HEADING}>
              Start here
            </h2>
            <ol className="mt-3 space-y-3 text-sm leading-relaxed text-stone-700">
              <li className="flex gap-3">
                <Step n={1} />
                <span>
                  Ask the{" "}
                  <Link href="/ai-chat" className={TEXT_LINK}>
                    AI chat
                  </Link>{" "}
                  a buying question, e.g. “Is an e-bike worth it for a 12 km commute?”
                </span>
              </li>
              <li className="flex gap-3">
                <Step n={2} />
                <span>Click “Why this ad?” on the sponsored card to see its receipt.</span>
              </li>
              <li className="flex gap-3">
                <Step n={3} />
                <span>
                  After ~20 s Chainlink settles it: the{" "}
                  <Link href="/dashboard" className={TEXT_LINK}>
                    publisher dashboard
                  </Link>{" "}
                  shows it paid (80 % app / 20 % Aria).
                </span>
              </li>
              <li className="flex gap-3">
                <Step n={4} />
                <span>
                  Launch your own campaign in the{" "}
                  <Link href="/advertise" className={TEXT_LINK}>
                    advertiser console
                  </Link>
                  .
                </span>
              </li>
            </ol>
          </section>

          <section aria-labelledby="proof">
            <h2 id="proof" className={HEADING}>
              Proof
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {recentReceipt}
              {proofLinks({ contract, envioUrl }).map((link) => (
                <li key={link.href}>
                  <ExternalLink href={link.href} className={TEXT_LINK}>
                    {link.label}
                  </ExternalLink>
                  {link.detail && <span className="ml-2 font-mono text-xs text-stone-500">{link.detail}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-4">
            <h2 id="how-it-works-title" className={HEADING}>
              How it works
            </h2>
            <dl className="mt-3 space-y-1.5 text-sm leading-snug">
              {SPONSORS.map((sponsor) => (
                <div key={sponsor.name} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-medium text-stone-900">{sponsor.name}</dt>
                  <dd className="text-stone-600">{sponsor.role}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm">
              <ExternalLink href={`${REPO_URL}#readme`} className={TEXT_LINK}>
                Details in the README
              </ExternalLink>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-white"
    >
      {n}
    </span>
  );
}
