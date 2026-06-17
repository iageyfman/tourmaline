"use server";

import { createServerClient } from "@/lib/supabase/server";
import type { View, ViewFilter, ViewRow } from "./types";

/**
 * Saved-view CRUD + the filter runner. Mirrors the bookmarks action idiom:
 * mutations return a discriminated union (thrown server-action errors are redacted across
 * the boundary in production), reads throw. The `views` table + its service_role grant ship
 * in migration 0008. Filtering reuses `notes_for_view` (predicates identical to search's).
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
  const { data, error } = await createServerClient()
    .from("views")
    .select(COLS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as View[];
}

export async function createView(
  input: ViewInput,
): Promise<{ ok: true; view: View } | { ok: false; message: string }> {
  try {
    const { data, error } = await createServerClient()
      .from("views")
      .insert({
        name: input.name,
        filter: input.filter,
        columns: input.columns,
        sort: input.sort,
        layout: input.layout,
      })
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, view: data as View };
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
    const { data, error } = await createServerClient()
      .from("views")
      .update(patch)
      .eq("id", id)
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, view: data as View };
  } catch (e) {
    return err(e);
  }
}

export async function deleteView(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await createServerClient().from("views").delete().eq("id", id);
    if (error) throw new Error(error.message);
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
  const { data, error } = await createServerClient().rpc("notes_for_view", {
    p_tag: filter.tag ?? null,
    p_path: filter.path ?? null,
    p_props: filter.props ?? [],
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ViewRow[];
}
