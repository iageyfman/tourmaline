import type { ViewRow } from "./types";

/** The pipeline's internal frontmatter markers — never shown as columns. */
const HIDDEN_KEYS = new Set(["_raw", "_raw_error"]);

/**
 * The menu of property keys available as columns: the union of keys across the given rows,
 * minus the pipeline's `_raw`/`_raw_error` markers. Sorted case-insensitively for a stable
 * picker order — the view's chosen `columns` array controls DISPLAY order, this is just the
 * set of choices. Pure.
 */
export function unionPropertyKeys(rows: ViewRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row.properties ?? {})) {
      if (!HIDDEN_KEYS.has(k)) keys.add(k);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** True when a row's frontmatter failed to parse — its cells must be read-only (editing it
 *  would destroy the user's raw YAML; the property action refuses anyway). */
export function rowHasInvalidYaml(row: ViewRow): boolean {
  return !!row.properties && "_raw_error" in row.properties;
}
