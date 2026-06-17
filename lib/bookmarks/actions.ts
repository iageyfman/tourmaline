"use server";

import { createServerClient } from "@/lib/supabase/server";

/**
 * Bookmarks — star a note, a search, or a heading. The `bookmarks` table
 * (migration 0001) already exists and is granted to service_role, so this adds NO migration.
 * Idempotency (don't double-star the same note/heading) is enforced HERE in the action layer
 * rather than via a DB unique index — single-user, low write volume, and it keeps this
 * migration-free.
 */
export interface Bookmark {
  id: string;
  kind: "note" | "search" | "heading";
  note_id: string | null;
  payload: Record<string, unknown>;
  label: string | null;
  sort_order: number;
}

const COLS = "id, kind, note_id, payload, label, sort_order";

function err(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/** All bookmarks in display order (sort_order asc, created_at asc as a tiebreak). Read: throws. */
export async function listBookmarks(): Promise<Bookmark[]> {
  const { data, error } = await createServerClient()
    .from("bookmarks")
    .select(COLS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Bookmark[];
}

export async function addBookmark(input: {
  kind: "note" | "search" | "heading";
  noteId?: string | null;
  payload?: Record<string, unknown>;
  label?: string | null;
}): Promise<{ ok: true; bookmark: Bookmark } | { ok: false; message: string }> {
  try {
    const db = createServerClient();
    // New bookmarks land at the bottom: sort_order = current max + 1.
    const { data: maxRow, error: maxErr } = await db
      .from("bookmarks")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw new Error(maxErr.message);
    const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
    const { data, error } = await db
      .from("bookmarks")
      .insert({
        kind: input.kind,
        note_id: input.noteId ?? null,
        payload: input.payload ?? {},
        label: input.label ?? null,
        sort_order: nextOrder,
      })
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, bookmark: data as Bookmark };
  } catch (e) {
    return err(e);
  }
}

export async function removeBookmark(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await createServerClient().from("bookmarks").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

/** Persist a new ordering: rewrite sort_order = index for each id, in order. Few bookmarks → a
 *  small loop is clearer than a bulk upsert (which would need every NOT NULL column re-supplied). */
export async function reorderBookmarks(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const db = createServerClient();
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await db.from("bookmarks").update({ sort_order: i }).eq("id", orderedIds[i]);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

/** Toggle a NOTE bookmark (editor-header ★): add if absent, remove if present. Returns the new
 *  starred state so the header updates without a refetch. Idempotency enforced here. */
export async function toggleNoteBookmark(
  noteId: string,
  label?: string,
): Promise<{ ok: true; bookmarked: boolean } | { ok: false; message: string }> {
  try {
    const db = createServerClient();
    const { data: existing, error: selErr } = await db
      .from("bookmarks")
      .select("id")
      .eq("kind", "note")
      .eq("note_id", noteId)
      .limit(1);
    if (selErr) throw new Error(selErr.message);
    if (existing && existing.length > 0) {
      const { error } = await db.from("bookmarks").delete().eq("id", (existing[0] as { id: string }).id);
      if (error) throw new Error(error.message);
      return { ok: true, bookmarked: false };
    }
    const res = await addBookmark({ kind: "note", noteId, label: label ?? null });
    return res.ok ? { ok: true, bookmarked: true } : res;
  } catch (e) {
    return err(e);
  }
}

/** Toggle a HEADING bookmark (outline-row ★), identified by (noteId, payload.slug). */
export async function toggleHeadingBookmark(input: {
  noteId: string;
  slug: string;
  text: string;
  noteTitle?: string;
}): Promise<{ ok: true; bookmarked: boolean } | { ok: false; message: string }> {
  try {
    const db = createServerClient();
    const { data: existing, error: selErr } = await db
      .from("bookmarks")
      .select("id")
      .eq("kind", "heading")
      .eq("note_id", input.noteId)
      .eq("payload->>slug", input.slug)
      .limit(1);
    if (selErr) throw new Error(selErr.message);
    if (existing && existing.length > 0) {
      const { error } = await db.from("bookmarks").delete().eq("id", (existing[0] as { id: string }).id);
      if (error) throw new Error(error.message);
      return { ok: true, bookmarked: false };
    }
    const label = input.noteTitle ? `${input.noteTitle} › ${input.text}` : input.text;
    const res = await addBookmark({
      kind: "heading",
      noteId: input.noteId,
      payload: { slug: input.slug, text: input.text },
      label,
    });
    return res.ok ? { ok: true, bookmarked: true } : res;
  } catch (e) {
    return err(e);
  }
}
