// Shared pieces of the advertiser console, in the publisher dashboard's visual language.

export const PRIMARY =
  "rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300";
export const SECONDARY =
  "rounded-lg border border-stone-200 bg-white px-5 py-3 text-sm font-medium text-stone-600 transition hover:text-stone-900 disabled:cursor-not-allowed disabled:text-stone-400";
export const SMALL_BUTTON =
  "rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 transition hover:text-stone-900 disabled:text-stone-400";
export const INPUT =
  "w-full rounded-lg border bg-white px-3 py-2.5 text-[15px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200";
export const LINK =
  "text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-stone-900";

export function inputBorder(invalid: boolean): string {
  return invalid ? "border-rose-400 focus:border-rose-500" : "border-stone-300 focus:border-stone-500";
}

export function Eyebrow() {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Aria for advertisers</p>;
}

/** Page frame with the eyebrow, the signed-in email and a sign-out button. */
export function ConsoleHeader({ email, onLogout, children }: { email?: string; onLogout?: () => void; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Eyebrow />
        {children}
      </div>
      {(email || onLogout) && (
        <div className="flex items-center gap-3">
          {email && <span className="text-sm text-stone-500">{email}</span>}
          {onLogout && (
            <button type="button" onClick={onLogout} className={SMALL_BUTTON}>
              Sign out
            </button>
          )}
        </div>
      )}
    </header>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-rose-700">
      {children}
    </p>
  );
}
