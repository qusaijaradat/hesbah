/**
 * Repeated keys for array values ("excludeFarmerIds=1&excludeFarmerIds=2"), because ASP.NET Core's
 * default model binding for a `List<int>` parameter doesn't understand axios's own
 * "excludeFarmerIds[]=1" bracket form — the same reason api/invoices.ts's print endpoints
 * hand-build their `ids=1&ids=2` query strings, generalized here to a whole filter object so every
 * scalar field keeps serializing exactly as before.
 *
 * Undefined/null values are dropped entirely (an omitted filter must not turn into "key=undefined"),
 * including inside arrays. An empty array contributes nothing, which is what "no exclusions" means.
 *
 * Its own module, with no imports, so it can be exercised on its own.
 */
export function serializeQueryParams(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}
