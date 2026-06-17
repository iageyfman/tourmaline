"use server";

import { queryOne } from "@/lib/db/server";
import { saveNote } from "@/lib/pipeline/save-note";
import { upsertFrontmatterProperty, removeFrontmatterProperty, InvalidYamlError } from "./yaml";

// Edits go to the body's YAML, then through the normal save pipeline (which re-derives
// notes.properties); the panel never writes `properties` directly.
type PropResult =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "invalid_yaml" | "error"; message: string };

const FIX_YAML = "Fix the frontmatter YAML in the editor first.";

async function applyToBody(noteId: string, transform: (body: string) => string): Promise<PropResult> {
  const note = await queryOne<{
    id: string;
    title: string;
    body: string;
    folder_id: string | null;
    properties: Record<string, unknown> | null;
  }>("select id, title, body, folder_id, properties from notes where id = $1 and deleted_at is null", [noteId]);
  if (!note) throw new Error("note not found");

  // Refuse to touch a note whose frontmatter didn't parse — rewriting it would destroy the
  // user's in-progress raw YAML. They fix it in the editor instead.
  const props = note.properties;
  if (props && "_raw_error" in props) return { ok: false, error: "invalid_yaml", message: FIX_YAML };

  let newBody: string;
  try {
    newBody = transform(note.body);
  } catch (e) {
    if (e instanceof InvalidYamlError) return { ok: false, error: "invalid_yaml", message: FIX_YAML };
    throw e;
  }

  try {
    const saved = await saveNote({
      id: noteId,
      title: note.title,
      body: newBody,
      folderId: note.folder_id ?? null,
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
