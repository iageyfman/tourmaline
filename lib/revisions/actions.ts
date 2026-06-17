"use server";

import { createServerClient } from "@/lib/supabase/server";
import { parseNote } from "@/lib/pipeline/parse";

/**
 * Version history over the existing `note_revisions` table (written + pruned by
 * the save pipeline, debounced 5 min, last-100). Reads are throw-on-error; restore returns a
 * discriminated result so the title-collision case surfaces cleanly across the server boundary.
 */

export interface RevisionMeta {
  id: string;
  title: string;
  created_at: string;
}

/** A note's revisions, newest first. No body (kept light — bodies load lazily via getRevision). */
export async function listRevisions(noteId: string): Promise<RevisionMeta[]> {
  const { data, error } = await createServerClient()
    .from("note_revisions")
    .select("id, title, created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RevisionMeta[];
}

/** One revision's full content (the read pane in the history modal). Throws on error. */
export async function getRevision(
  revisionId: string,
): Promise<{ id: string; title: string; body: string; created_at: string }> {
  const { data, error } = await createServerClient()
    .from("note_revisions")
    .select("id, title, body, created_at")
    .eq("id", revisionId)
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; title: string; body: string; created_at: string };
}

type RestoreResult =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "duplicate_title" | "not_found" | "error"; message: string };

/**
 * Restore a revision onto its note. Re-parses the revision body in TS to derive
 * properties/links/tags, then calls `restore_revision`, which sets title/body/properties and
 * ALWAYS cuts a new revision (history is never destroyed). Restoring an old title that now
 * collides with another live note hits `notes_title_unique` → 23505 → `duplicate_title`
 * folder_id / is_daily / daily_date are preserved.
 */
export async function restoreRevision(noteId: string, revisionId: string): Promise<RestoreResult> {
  const db = createServerClient();

  const { data: rev, error } = await db
    .from("note_revisions")
    .select("id, title, body")
    .eq("id", revisionId)
    .eq("note_id", noteId)
    .single();
  if (error || !rev) return { ok: false, error: "not_found", message: "That revision no longer exists." };

  const parsed = parseNote({ title: rev.title as string, body: rev.body as string });

  const { data, error: rpcErr } = await db.rpc("restore_revision", {
    p_note_id: noteId,
    p_revision_id: revisionId,
    p_properties: parsed.properties,
    p_links: parsed.links.map((l) => ({
      target_title: l.targetTitle,
      is_embed: l.isEmbed,
      position: l.position,
    })),
    p_tags: parsed.tags,
  });
  if (rpcErr) {
    if ((rpcErr as { code?: string }).code === "23505") {
      return { ok: false, error: "duplicate_title", message: "A note with that title already exists." };
    }
    return { ok: false, error: "error", message: rpcErr.message };
  }
  return { ok: true, note: data as Record<string, unknown> };
}
