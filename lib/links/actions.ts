"use server";

import { query, queryOne } from "@/lib/db/server";
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
  const note = await queryOne<{ title: string }>("select title from notes where id = $1", [noteId]);
  const targetTitle = note?.title ?? "";

  // Disambiguate the FK (links has two FKs to notes): embed the SOURCE note.
  const rows = await query<{ source_id: string; title: string; body: string }>(
    `select l.source_id, n.title, n.body
     from links l
     join notes n on n.id = l.source_id
     where l.target_id = $1
       and l.source_id <> $1
       and n.deleted_at is null`,
    [noteId],
  );

  const bySource = new Map<string, { title: string; body: string }>();
  for (const row of rows) {
    if (!bySource.has(row.source_id)) bySource.set(row.source_id, { title: row.title, body: row.body });
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
  const rows = await query<{
    target_id: string | null;
    target_title: string;
    is_embed: boolean;
    title: string | null;
    deleted_at: string | null;
  }>(
    `select l.target_id, l.target_title, l.is_embed, n.title, n.deleted_at
     from links l
     left join notes n on n.id = l.target_id
     where l.source_id = $1
     order by l.position asc`,
    [noteId],
  );

  const resolved = new Map<string, ResolvedOut>(); // key: targetId
  const unresolved = new Map<string, UnresolvedOut>(); // key: lower(target_title)
  for (const row of rows) {
    const targetId = row.target_id;
    const isEmbed = row.is_embed ?? false;
    if (targetId) {
      if (targetId === noteId) continue; // skip self-links (consistent with backlinks)
      if (!row.title || row.deleted_at !== null) continue; // target trashed/missing → hide the row
      const prev = resolved.get(targetId);
      resolved.set(targetId, { targetId, title: row.title, isEmbed: (prev?.isEmbed ?? false) || isEmbed });
    } else {
      const rawTitle = row.target_title.trim();
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
  const note = await queryOne<{ title: string }>("select title from notes where id = $1", [noteId]);
  const title = (note?.title ?? "").trim();
  if (!title) return []; // a blank title would match everything — show nothing

  const rows = await query<{ id: string; title: string; body: string }>(
    "select * from notes_containing_text($1::uuid)",
    [noteId],
  );

  const result: UnlinkedMention[] = [];
  for (const row of rows) {
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
  const src = await queryOne<{ id: string; title: string; body: string; folder_id: string | null }>(
    "select id, title, body, folder_id from notes where id = $1 and deleted_at is null",
    [sourceId],
  );
  if (!src) return { ok: false, error: "error", message: "Source note not found." };

  const newBody = linkMentionsInBody(src.body, targetTitle);
  try {
    const note = await saveNote({
      id: sourceId,
      title: src.title,
      body: newBody,
      folderId: src.folder_id ?? null,
    });
    return { ok: true, note };
  } catch (e) {
    return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
