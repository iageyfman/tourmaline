"use server";

import { createServerClient } from "@/lib/supabase/server";
import { saveNote } from "@/lib/pipeline/save-note";
import { upsertFrontmatterProperty, removeFrontmatterProperty, InvalidYamlError } from "./yaml";

// Edits go to the body's YAML, then through the normal save pipeline (which re-derives
// notes.properties) — the panel never writes `properties` directly (CLAUDE.md rule #2).
type PropResult =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "invalid_yaml" | "error"; message: string };

const FIX_YAML = "Fix the frontmatter YAML in the editor first.";

async function applyToBody(noteId: string, transform: (body: string) => string): Promise<PropResult> {
  const client = createServerClient();
  const { data: note, error } = await client
    .from("notes")
    .select("id, title, body, folder_id, properties")
    .eq("id", noteId)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  if (!note) throw new Error("note not found");

  // Refuse to touch a note whose frontmatter didn't parse — rewriting it would destroy the
  // user's in-progress raw YAML. They fix it in the editor instead.
  const props = note.properties as Record<string, unknown> | null;
  if (props && "_raw_error" in props) return { ok: false, error: "invalid_yaml", message: FIX_YAML };

  let newBody: string;
  try {
    newBody = transform(note.body as string);
  } catch (e) {
    if (e instanceof InvalidYamlError) return { ok: false, error: "invalid_yaml", message: FIX_YAML };
    throw e;
  }

  try {
    const saved = await saveNote(client, {
      id: noteId,
      title: note.title as string,
      body: newBody,
      folderId: (note.folder_id as string | null) ?? null,
    });
    return { ok: true, note: saved };
  } catch (e) {
    return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function setNoteProperty(noteId: string, key: string, value: unknown): Promise<PropResult> {
  return applyToBody(noteId, (body) => upsertFrontmatterProperty(body, key, value));
}

export async function deleteNoteProperty(noteId: string, key: string): Promise<PropResult> {
  return applyToBody(noteId, (body) => removeFrontmatterProperty(body, key));
}
