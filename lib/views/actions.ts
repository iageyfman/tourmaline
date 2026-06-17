"use server";

import { execute, query, queryOne } from "@/lib/db/server";
import type { View, ViewFilter, ViewRow } from "./types";

/**
 * Saved-view CRUD + the filter runner. Mirrors the bookmarks action idiom:
 * mutations return a discriminated union (thrown server-action errors are redacted across
 * the boundary in production), reads throw. Filtering reuses `notes_for_view`
 * (predicates identical to search's).
 */
const COLS = "id, name, filter, columns, sort, layout, created_at";

function err(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

export interface ViewInput {
  name: string;
  filter: ViewFilter;
  columns: string[];
  sort: { key: string; dir: "asc" | "desc" };
  layout: "table" | "cards";
}

/** All saved views in creation order (no reorder UI in V1). Read: throws. */
export async function listViews(): Promise<View[]> {
  return query<View>(`select ${COLS} from views order by created_at asc`);
}

export async function createView(
  input: ViewInput,
): Promise<{ ok: true; view: View } | { ok: false; message: string }> {
  try {
    const view = await queryOne<View>(
      `insert into views (name, filter, columns, sort, layout)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
       returning ${COLS}`,
      [
        input.name,
        JSON.stringify(input.filter),
        JSON.stringify(input.columns),
        JSON.stringify(input.sort),
        input.layout,
      ],
    );
    if (!view) throw new Error("createView returned no row");
    return { ok: true, view };
  } catch (e) {
    return err(e);
  }
}

/** Patch any subset of a view's definition (name / filter / columns / sort / layout). */
export async function updateView(
  id: string,
  patch: Partial<ViewInput>,
): Promise<{ ok: true; view: View } | { ok: false; message: string }> {
  try {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const add = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    };
    if (patch.name !== undefined) add("name", patch.name);
    if (patch.filter !== undefined) add("filter", JSON.stringify(patch.filter), "::jsonb");
    if (patch.columns !== undefined) add("columns", JSON.stringify(patch.columns), "::jsonb");
    if (patch.sort !== undefined) add("sort", JSON.stringify(patch.sort), "::jsonb");
    if (patch.layout !== undefined) add("layout", patch.layout);
    if (sets.length === 0) {
      const existing = await queryOne<View>(`select ${COLS} from views where id = $1`, [id]);
      if (!existing) throw new Error("View not found.");
      return { ok: true, view: existing };
    }
    const view = await queryOne<View>(
      `update views set ${sets.join(", ")} where id = $1 returning ${COLS}`,
      values,
    );
    if (!view) throw new Error("View not found.");
    return { ok: true, view };
  } catch (e) {
    return err(e);
  }
}

export async function deleteView(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await execute("delete from views where id = $1", [id]);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

/**
 * Run a view's filter → matching live notes with their `properties` (for the column cells).
 * Reuses the `notes_for_view` RPC. Unlike `searchNotes` (which short-circuits an empty box),
 * an EMPTY filter legitimately means "all live notes" — always hit the RPC. Read: throws.
 */
export async function runView(filter: ViewFilter): Promise<ViewRow[]> {
  return query<ViewRow>(
    "select * from notes_for_view($1, $2, $3::jsonb)",
    [filter.tag ?? null, filter.path ?? null, JSON.stringify(filter.props ?? [])],
  );
}
