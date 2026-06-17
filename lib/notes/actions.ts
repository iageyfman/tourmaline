"use server";

import { execute, query, queryOne } from "@/lib/db/server";
import { saveNote } from "@/lib/pipeline/save-note";

// Mutations RETURN a discriminated result rather than throwing: thrown errors in
// server actions are redacted across the server->client boundary in production, so
// the client can't see "duplicate title". A returned union is serialized cleanly.
type SaveResult =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "duplicate_title" | "error"; message: string };

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  folder_id: string | null;
  properties: Record<string, unknown>;
  is_daily: boolean;
  daily_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function asSaveError(e: unknown): { ok: false; error: "duplicate_title" | "error"; message: string } {
  if ((e as { code?: string }).code === "23505") {
    return { ok: false, error: "duplicate_title", message: "A note with that title already exists." };
  }
  return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
}

export async function createNote(input: {
  title?: string;
  body?: string;
  folderId?: string | null;
}): Promise<SaveResult> {
  const body = input.body ?? "";
  const folderId = input.folderId ?? null;
  const explicit = (input.title ?? "").trim();

  if (explicit) {
    try {
      return { ok: true, note: await saveNote({ id: null, title: explicit, body, folderId }) };
    } catch (e) {
      return asSaveError(e);
    }
  }

  // No title supplied (e.g. explorer "+ note") -> first free "Untitled", "Untitled 2", ...
  for (let n = 1; n <= 100; n++) {
    const title = n === 1 ? "Untitled" : `Untitled ${n}`;
    try {
      return { ok: true, note: await saveNote({ id: null, title, body, folderId }) };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") continue; // title taken, try next
      return asSaveError(e);
    }
  }
  return { ok: false, error: "error", message: "Could not generate a unique Untitled title." };
}

export async function updateNote(input: {
  id: string;
  title: string;
  body: string;
  folderId?: string | null;
}): Promise<SaveResult> {
  try {
    return { ok: true, note: await saveNote(input) };
  } catch (e) {
    return asSaveError(e);
  }
}

export async function getNote(id: string): Promise<NoteRow> {
  const note = await queryOne<NoteRow>("select * from notes where id = $1 and deleted_at is null", [id]);
  if (!note) throw new Error("Note not found.");
  return note;
}

/** Full note bodies for all live notes, newest first. */
export async function listNotes(): Promise<
  { id: string; title: string; body: string; updated_at: string }[]
> {
  return query<{ id: string; title: string; body: string; updated_at: string }>(
    "select id, title, body, updated_at from notes where deleted_at is null order by updated_at desc",
  );
}

/** Lightweight rows for the explorer tree: no body, ordered by title (avoids reordering
 *  under the cursor as autosave bumps updated_at). */
export async function listNotesForTree(): Promise<
  { id: string; title: string; folder_id: string | null }[]
> {
  return query<{ id: string; title: string; folder_id: string | null }>(
    "select id, title, folder_id from notes where deleted_at is null order by title asc",
  );
}

/** Bodies for a set of notes by id (for inline embeds). The client maps `![[Title]]` targets to
 *  ids from its in-memory note list, then calls this to render them inline. Live notes only.
 *  Read action: throws on error. */
export async function getNoteBodies(
  ids: string[],
): Promise<{ id: string; title: string; body: string }[]> {
  if (ids.length === 0) return [];
  return query<{ id: string; title: string; body: string }>(
    "select id, title, body from notes where id = any($1::uuid[]) and deleted_at is null",
    [ids],
  );
}

export async function softDeleteNote(id: string) {
  await execute("update notes set deleted_at = now() where id = $1 and deleted_at is null", [id]);
}
