/**
 * Coerce a raw string from an inline cell editor into the right JSON type for write-back
 * through the property pipeline. ANCHORED to the existing value's type: editing
 * `priority: 5` (number) must stay a number, not become "5" — otherwise the YAML round-trip
 * (`doc.set(key, "5")` emits a quoted string) corrupts the type and breaks numeric sort and
 * `prop:key=value` matching. For a brand-new key (existing === undefined) there's no type to
 * preserve, so fall back to a light heuristic. Pure.
 *
 *   boolean → true/false (or the prior value if the text isn't a bool)
 *   number  → Number(raw) when it parses finite, else the raw string (deliberate retype)
 *   array   → CSV split into a string[]
 *   string  → the raw string (covers dates too — the pipeline stores YAML dates as strings)
 *   new key → "true"/"false" → bool, finite → number, else string
 */
function csvToList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function parseBool(raw: string, fallback: boolean): boolean {
  const t = raw.trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  return fallback;
}

function heuristic(raw: string): unknown {
  const t = raw.trim();
  if (t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  if (t !== "" && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

export function coerceCellValue(existing: unknown, raw: string): unknown {
  if (typeof existing === "boolean") return parseBool(raw, existing);
  if (typeof existing === "number") {
    return raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  if (Array.isArray(existing)) return csvToList(raw);
  if (typeof existing === "string") return raw;
  return heuristic(raw); // new / null / unknown key
}
