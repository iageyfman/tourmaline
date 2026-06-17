import type { ViewRow, ViewSort } from "./types";

/**
 * Client-side row sorting for a saved view — sorting in JS, not SQL, avoids a
 * dynamic `order by properties->>key` (single-user, small vault). Pure; returns a new array.
 *
 * Rules:
 *  - The key is a property key OR a builtin (`title`/`updated`/`created`) mapped to the row's
 *    own column.
 *  - Compare numerically when BOTH values parse as finite numbers; otherwise case-insensitive
 *    lexical (with `numeric:true` so "n2" precedes "n10"). ISO date strings sort correctly
 *    lexically (so a `date` property orders naturally without special-casing).
 *  - Rows MISSING the key always sink to the bottom, regardless of direction.
 *  - Deterministic tiebreak by title (ascending), independent of direction.
 */
function valueForKey(row: ViewRow, key: string): unknown {
  switch (key) {
    case "title":
      return row.title;
    case "updated":
      return row.updated_at;
    case "created":
      return row.created_at;
    default:
      return row.properties?.[key];
  }
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toComparable(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function byTitle(a: ViewRow, b: ViewRow): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function sortViewRows(rows: ViewRow[], sort: ViewSort): ViewRow[] {
  const factor = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = valueForKey(a, sort.key);
    const bv = valueForKey(b, sort.key);
    const aBlank = isBlank(av);
    const bBlank = isBlank(bv);
    if (aBlank && bBlank) return byTitle(a, b);
    if (aBlank) return 1; // missing → bottom, both directions
    if (bBlank) return -1;

    const an = asNumber(av);
    const bn = asNumber(bv);
    const cmp =
      an !== null && bn !== null
        ? an - bn
        : toComparable(av).localeCompare(toComparable(bv), undefined, {
            sensitivity: "base",
            numeric: true,
          });
    return cmp !== 0 ? cmp * factor : byTitle(a, b);
  });
}
