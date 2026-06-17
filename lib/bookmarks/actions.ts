"use server";

import { execute, query, queryOne } from "@/lib/db/server";

/**
 * Bookmarks — star a note, a search, or a heading. The `bookmarks` table
 * already exists in the initial schema, so this adds no migration.
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
  return query<Bookmark>(`select ${COLS} from bookmarks order by sort_order asc, created_at asc`);
}

export async function addBookmark(input: {
  kind: "note" | "search" | "heading";
  noteId?: string | null;
  payload?: Record<string, unknown>;
  label?: string | null;
}): Promise<{ ok: true; bookmark: Bookmark } | { ok: false; message: string }> {
  try {
    // New bookmarks land at the bottom: sort_order = current max + 1.
    const maxRow = await queryOne<{ sort_order: number }>(
      "select sort_order from bookmarks order by sort_order desc limit 1",
    );
    const nextOrder = (maxRow?.sort_order ?? -1) + 1;
    const bookmark = await queryOne<Bookmark>(
      `insert into bookmarks (kind, note_id, payload, label, sort_order)
       values ($1, $2, $3::jsonb, $4, $5)
       returning ${COLS}`,
      [input.kind, input.noteId ?? null, JSON.stringify(input.payload ?? {}), input.label ?? null, nextOrder],
    );
    if (!bookmark) throw new Error("addBookmark returned no row");
    return { ok: true, bookmark };
  } catch (e) {
    return err(e);
  }
}

export async function removeBookmark(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await execute("delete from bookmarks where id = $1", [id]);
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
    for (let i = 0; i < orderedIds.length; i++) {
      await execute("update bookmarks set sort_order = $2 where id = $1", [orderedIds[i], i]);
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
    const existing = await queryOne<{ id: string }>(
      "select id from bookmarks where kind = 'note' and note_id = $1 limit 1",
      [noteId],
    );
    if (existing) {
      await execute("delete from bookmarks where id = $1", [existing.id]);
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
    const existing = await queryOne<{ id: string }>(
      "select id from bookmarks where kind = 'heading' and note_id = $1 and payload->>'slug' = $2 limit 1",
      [input.noteId, input.slug],
    );
    if (existing) {
      await execute("delete from bookmarks where id = $1", [existing.id]);
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
