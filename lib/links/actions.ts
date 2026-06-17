"use server";

import { createServerClient } from "@/lib/supabase/server";
import { saveNote } from "@/lib/pipeline/save-note";
import { backlinkSnippets, type Backlink } from "./snippets";
import { findUnlinkedMentions, linkMentionsInBody, type UnlinkedMention } from "./mentions";
import type { OutgoingLinks, ResolvedOut, UnresolvedOut } from "./outgoing";

/**
 * Incoming links to a note — the first feature to read the `links` table.
 * Groups by source note (a source may link the target multiple times), excludes self-links
 * and trashed sources, and computes context snippets from each source body. Read-only:
 * throws on error (like getNote), no discriminated result.
 */
export async function getBacklinks(noteId: string): Promise<Backlink[]> {
  const db = createServerClient();

  const { data: note, error: nErr } = await db
    .from("notes")
    .select("title")
    .eq("id", noteId)
    .single();
  if (nErr) throw new Error(nErr.message);
  const targetTitle = (note?.title as string) ?? "";

  // Disambiguate the FK (links has two FKs to notes): embed the SOURCE note.
  const { data, error } = await db
    .from("links")
    .select("source_id, notes!links_source_id_fkey(title, body, deleted_at)")
    .eq("target_id", noteId)
    .neq("source_id", noteId);
  if (error) throw new Error(error.message);

  const bySource = new Map<string, { title: string; body: string }>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const raw = row.notes;
    const src = (Array.isArray(raw) ? raw[0] : raw) as
      | { title: string; body: string; deleted_at: string | null }
      | null
      | undefined;
    if (!src || src.deleted_at !== null) continue; // skip trashed sources
    const sourceId = row.source_id as string;
    if (!bySource.has(sourceId)) bySource.set(sourceId, { title: src.title, body: src.body });
  }

  const result: Backlink[] = [];
  for (const [sourceId, src] of bySource) {
    result.push({ sourceId, sourceTitle: src.title, snippets: backlinkSnippets(src.body, targetTitle) });
  }
  result.sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
  return result;
}

/**
 * Outgoing links — the companion to getBacklinks: every link FROM this note,
 * resolved vs unresolved separated. Mirrors getBacklinks but reads `source_id` and embeds the
 * TARGET note (links has two FKs to notes → disambiguate via links_target_id_fkey). The save
 * pipeline can write the same target many times (e.g. once as `[[X]]` and once as `![[X]]`), so
 * we DEDUP: resolved by target id, unresolved by lowercased title. A row whose target_id is set
 * but whose target is soft-deleted is hidden (neither resolved nor unresolved — honest). A row
 * is tagged `isEmbed` if ANY of its occurrences was an embed. Read-only: throws on error.
 */
export async function getOutgoingLinks(noteId: string): Promise<OutgoingLinks> {
  const db = createServerClient();

  const { data, error } = await db
    .from("links")
    .select("target_id, target_title, is_embed, position, notes!links_target_id_fkey(title, deleted_at)")
    .eq("source_id", noteId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const resolved = new Map<string, ResolvedOut>(); // key: targetId
  const unresolved = new Map<string, UnresolvedOut>(); // key: lower(target_title)
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const targetId = row.target_id as string | null;
    const isEmbed = (row.is_embed as boolean) ?? false;
    if (targetId) {
      if (targetId === noteId) continue; // skip self-links (consistent with backlinks)
      const raw = row.notes;
      const tgt = (Array.isArray(raw) ? raw[0] : raw) as
        | { title: string; deleted_at: string | null }
        | null
        | undefined;
      if (!tgt || tgt.deleted_at !== null) continue; // target trashed/missing → hide the row
      const prev = resolved.get(targetId);
      resolved.set(targetId, { targetId, title: tgt.title, isEmbed: (prev?.isEmbed ?? false) || isEmbed });
    } else {
      const rawTitle = (row.target_title as string).trim();
      if (!rawTitle) continue;
      const key = rawTitle.toLowerCase();
      const prev = unresolved.get(key);
      unresolved.set(key, { title: rawTitle, isEmbed: (prev?.isEmbed ?? false) || isEmbed });
    }
  }

  return {
    resolved: [...resolved.values()].sort((a, b) => a.title.localeCompare(b.title)),
    unresolved: [...unresolved.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/**
 * Unlinked mentions — notes whose body contains THIS note's title as plain text,
 * WITHOUT a link. Coarse candidates come from `notes_containing_text` (a literal-substring
 * prefilter, a strict superset); the precise pass (mask code, exclude existing links + the
 * note's own frontmatter, whole-word) runs in TS via `findUnlinkedMentions` — note parsing stays
 * in TypeScript. Computed on demand, never stored. Read-only: throws on error.
 */
export async function getUnlinkedMentions(noteId: string): Promise<UnlinkedMention[]> {
  const db = createServerClient();

  const { data: note, error: nErr } = await db
    .from("notes")
    .select("title")
    .eq("id", noteId)
    .single();
  if (nErr) throw new Error(nErr.message);
  const title = ((note?.title as string) ?? "").trim();
  if (!title) return []; // a blank title would match everything — show nothing

  const { data, error } = await db.rpc("notes_containing_text", { p_note_id: noteId });
  if (error) throw new Error(error.message);

  const result: UnlinkedMention[] = [];
  for (const row of (data ?? []) as Array<{ id: string; title: string; body: string }>) {
    const snippets = findUnlinkedMentions(row.body, title);
    if (snippets.length > 0) result.push({ sourceId: row.id, sourceTitle: row.title, snippets });
  }
  result.sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
  return result;
}

/**
 * "Link it": rewrite every plain-text occurrence of `targetTitle` in the source
 * note's body to `[[targetTitle]]`, then re-save through the pipeline (which resolves the new
 * link and gives the target a backlink). `linkMentionsInBody` reuses the same mask the detection
 * does, so code / existing links / frontmatter are untouched. Linking can't change the source's
 * own title, so there's no duplicate-title path. Mutation → discriminated result.
 */
export async function linkMention(
  sourceId: string,
  targetTitle: string,
): Promise<
  { ok: true; note: Record<string, unknown> } | { ok: false; error: "error"; message: string }
> {
  const db = createServerClient();
  const { data: src, error } = await db
    .from("notes")
    .select("id, title, body, folder_id")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .single();
  if (error) return { ok: false, error: "error", message: error.message };
  if (!src) return { ok: false, error: "error", message: "Source note not found." };

  const newBody = linkMentionsInBody(src.body as string, targetTitle);
  try {
    const note = await saveNote(db, {
      id: sourceId,
      title: src.title as string,
      body: newBody,
      folderId: (src.folder_id as string | null) ?? null,
    });
    return { ok: true, note };
  } catch (e) {
    return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
