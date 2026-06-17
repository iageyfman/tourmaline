// Shared types for database-style views. Pure (no "use server" / no React), so
// the server action, the pure helpers (sort/columns), and the client components can all
// import these without dragging server code into the client bundle.

export type ViewLayout = "table" | "cards";

/** One property filter clause. `value: null` means "key exists" (no equality check). */
export interface ViewPropFilter {
  key: string;
  value: string | null;
}

/** A saved view's filter. Mirrors the `search_notes` operator set: one tag (+descendants),
 *  one folder path (+subtree), and N property clauses that AND together. */
export interface ViewFilter {
  tag: string | null;
  path: string | null;
  props: ViewPropFilter[];
}

/** Sort key is a property key OR a builtin column (see BUILTIN_SORT_KEYS). */
export interface ViewSort {
  key: string;
  dir: "asc" | "desc";
}

/** Builtin (non-property) sortable/displayable keys → mapped to ViewRow's own columns. */
export const BUILTIN_SORT_KEYS = ["title", "updated", "created"] as const;

export interface View {
  id: string;
  name: string;
  filter: ViewFilter;
  columns: string[]; // ordered property keys to display
  sort: ViewSort;
  layout: ViewLayout;
  created_at: string;
}

/** One row returned by the `notes_for_view` RPC — what the table/grid renders. */
export interface ViewRow {
  id: string;
  title: string;
  folder_id: string | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
