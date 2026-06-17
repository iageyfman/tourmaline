"use server";

import { createServerClient } from "@/lib/supabase/server";
import { saveNote } from "@/lib/pipeline/save-note";

// Mutations RETURN a discriminated result rather than throwing: thrown errors in
// server actions are redacted across the server->client boundary in production, so
// the client can't see "duplicate title". A returned union is serialized cleanly.
type SaveResult =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "duplicate_title" | "error"; message: string };

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
  const client = createServerClient();
  const body = input.body ?? "";
  const folderId = input.folderId ?? null;
  const explicit = (input.title ?? "").trim();

  if (explicit) {
    try {
      return { ok: true, note: await saveNote(client, { id: null, title: explicit, body, folderId }) };
    } catch (e) {
      return asSaveError(e);
    }
  }

  // No title supplied (e.g. explorer "+ note") -> first free "Untitled", "Untitled 2", ...
  for (let n = 1; n <= 100; n++) {
    const title = n === 1 ? "Untitled" : `Untitled ${n}`;
    try {
      return { ok: true, note: await saveNote(client, { id: null, title, body, folderId }) };
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
    return { ok: true, note: await saveNote(createServerClient(), input) };
  } catch (e) {
    return asSaveError(e);
  }
}

export async function getNote(id: string) {
  const { data, error } = await createServerClient()
    .from("notes")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Full note bodies for all live notes, newest first. */
export async function listNotes(): Promise<
  { id: string; title: string; body: string; updated_at: string }[]
> {
  const { data, error } = await createServerClient()
    .from("notes")
    .select("id, title, body, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string; body: string; updated_at: string }[];
}

/** Lightweight rows for the explorer tree: no body, ordered by title (avoids reordering
 *  under the cursor as autosave bumps updated_at). */
export async function listNotesForTree(): Promise<
  { id: string; title: string; folder_id: string | null }[]
> {
  const { data, error } = await createServerClient()
    .from("notes")
    .select("id, title, folder_id")
    .is("deleted_at", null)
    .order("title", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string; folder_id: string | null }[];
}

/** Bodies for a set of notes by id (for inline embeds). The client maps `![[Title]]` targets to
 *  ids from its in-memory note list, then calls this to render them inline. Live notes only.
 *  Read action: throws on error. */
export async function getNoteBodies(
  ids: string[],
): Promise<{ id: string; title: string; body: string }[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createServerClient()
    .from("notes")
    .select("id, title, body")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string; body: string }[];
}

export async function softDeleteNote(id: string) {
  const { error } = await createServerClient()
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}
