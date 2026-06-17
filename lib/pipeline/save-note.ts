import type { SupabaseClient } from "@supabase/supabase-js";
import { parseNote } from "./parse";

export interface SaveNoteInput {
  /** Omit / null to create a new note; provide to update an existing one. */
  id?: string | null;
  title: string;
  body: string;
  folderId?: string | null;
}

/**
 * The save pipeline. Parses the note in TypeScript, then hands the
 * structured result to the `save_note` Postgres function, which performs all DB
 * writes (rebuild links + tags, debounced revision, claim unresolved, bump
 * updated_at) atomically in one transaction.
 *
 * Framework-agnostic: takes a Supabase client, so server actions and the
 * exit-test script share exactly one code path.
 */
export async function saveNote(client: SupabaseClient, input: SaveNoteInput) {
  const parsed = parseNote({ title: input.title, body: input.body });

  const { data, error } = await client.rpc("save_note", {
    p_id: input.id ?? null,
    p_title: parsed.title,
    p_body: parsed.body,
    p_folder_id: input.folderId ?? null,
    p_properties: parsed.properties,
    p_links: parsed.links.map((l) => ({
      target_title: l.targetTitle,
      is_embed: l.isEmbed,
      position: l.position,
    })),
    p_tags: parsed.tags,
  });

  if (error) {
    // Preserve the Postgres error code so callers can map e.g. 23505 (unique title).
    const err = new Error(`save_note failed: ${error.message}`) as Error & { code?: string };
    err.code = error.code;
    throw err;
  }
  return data as Record<string, unknown>;
}
