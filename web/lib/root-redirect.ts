export type SearchParams = Record<string, string | string[] | undefined>;

/** `/ai-chat` with the same query when `/` is opened with a `debug` param (old debug links), else null. */
export function chatRedirect(searchParams: SearchParams | undefined): string | null {
  if (!searchParams || searchParams.debug === undefined) return null;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(name, item);
  }
  return `/ai-chat?${query}`;
}
