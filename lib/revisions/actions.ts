"use server";

import { query, queryOne } from "@/lib/db/server";
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
  return query<RevisionMeta>(
    "select id, title, created_at from note_revisions where note_id = $1 order by created_at desc",
    [noteId],
  );
}

/** One revision's full content (the read pane in the history modal). Throws on error. */
export async function getRevision(
  revisionId: string,
): Promise<{ id: string; title: string; body: string; created_at: string }> {
  const revision = await queryOne<{ id: string; title: string; body: string; created_at: string }>(
    "select id, title, body, created_at from note_revisions where id = $1",
    [revisionId],
  );
  if (!revision) throw new Error("Revision not found.");
  return revision;
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
  const rev = await queryOne<{ id: string; title: string; body: string }>(
    "select id, title, body from note_revisions where id = $1 and note_id = $2",
    [revisionId, noteId],
  );
  if (!rev) return { ok: false, error: "not_found", message: "That revision no longer exists." };

  const parsed = parseNote({ title: rev.title, body: rev.body });

  const links = parsed.links.map((l) => ({
    target_title: l.targetTitle,
    is_embed: l.isEmbed,
    position: l.position,
  }));
  try {
    const row = await queryOne<{ note: Record<string, unknown> }>(
      "select restore_revision($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::text[]) as note",
      [noteId, revisionId, JSON.stringify(parsed.properties), JSON.stringify(links), parsed.tags],
    );
    if (!row) throw new Error("restore_revision returned no row");
    return { ok: true, note: row.note };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return { ok: false, error: "duplicate_title", message: "A note with that title already exists." };
    }
    return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
