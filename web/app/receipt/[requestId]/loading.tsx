export default function Loading() {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-14 sm:py-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Aria receipt</p>
          <p className="mt-2 text-sm text-stone-500">Reading the receipt from Monad…</p>
        </div>
        <div className="animate-pulse space-y-3" aria-hidden>
          <div className="h-8 w-11/12 rounded bg-stone-200/70" />
          <div className="h-8 w-2/3 rounded bg-stone-200/70" />
        </div>
        <div className="animate-pulse space-y-2 border-t border-stone-200 pt-6" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded-lg bg-stone-200/50" />
          ))}
        </div>
      </div>
    </main>
  );
}
