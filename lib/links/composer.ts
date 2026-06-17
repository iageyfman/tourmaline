"use server";

import { query, queryOne, type DbClient } from "@/lib/db/server";
import { parseNote, normalizeBody, parseFrontmatter } from "@/lib/pipeline/parse";
import type { ParsedLink } from "@/lib/pipeline/types";
import { rewriteLinkTarget } from "./rewrite";

/**
 * The note composer + the rename cascade. Three mutations, each a
 * single atomic Postgres function (merge_notes / extract_note / rename_note, migration 0010)
 * that reuses the canonical rebuild_note_derived. ALL parsing stays in TypeScript (parseNote +
 * rewriteLinkTarget); these actions compute the new bodies and pre-parsed
 * link/tag arrays and hand them to the RPC. Mutations RETURN a discriminated result (never
 * throw across the server→client boundary — thrown errors are redacted in production), mirroring
 * lib/notes/actions.ts's `asSaveError` (23505 → duplicate_title).
 */
type Result =
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: "duplicate_title" | "error"; message: string };

function fail(e: unknown): Result {
  if ((e as { code?: string }).code === "23505") {
    return { ok: false, error: "duplicate_title", message: "A note with that title already exists." };
  }
  return { ok: false, error: "error", message: e instanceof Error ? e.message : String(e) };
}

/** Map parsed links to the {target_title,is_embed,position} jsonb shape the RPCs expect (same
 *  mapping as lib/pipeline/save-note.ts). */
function linkRows(links: ParsedLink[]) {
  return links.map((l) => ({ target_title: l.targetTitle, is_embed: l.isEmbed, position: l.position }));
}

/**
 * Inbound linkers to a title, for the cascade. The candidate set is the union of resolved rows
 * (`target_id = noteId`) and stale-unresolved rows (`target_id is null AND lower(target_title) =
 * lower(title)` — a note whose `[[Title]]` predates the target and was never re-saved). The
 * ACTUAL rewrite is then computed from each candidate's BODY via rewriteLinkTarget (trusting the
 * body, not the links row's casing), keeping only bodies that actually change (so a `[[Title]]`
 * that lives only inside code is correctly skipped). Trashed sources drop out (the bodies query
 * is live-only). `excludeIds` removes the source/target themselves.
 */
async function inboundLinkers(
  db: DbClient | undefined,
  noteId: string,
  title: string,
  fromTitle: string,
  toTitle: string,
  excludeIds: string[],
) {
  const linkData = await query<{ source_id: string; target_id: string | null; target_title: string }>(
    "select source_id, target_id, target_title from links where target_id = $1 or target_id is null",
    [noteId],
    db,
  );

  const titleLower = title.trim().toLowerCase();
  const excluded = new Set(excludeIds);
  const ids = new Set<string>();
  for (const row of linkData) {
    if (excluded.has(row.source_id)) continue;
    if (row.target_id === noteId) ids.add(row.source_id);
    else if (row.target_id === null && (row.target_title ?? "").trim().toLowerCase() === titleLower)
      ids.add(row.source_id);
  }
  if (ids.size === 0) return [];

  const bodies = await query<{ id: string; title: string; body: string }>(
    "select id, title, body from notes where id = any($1::uuid[]) and deleted_at is null",
    [[...ids]],
    db,
  );

  const out: Array<{ id: string; title: string; body: string; links: ReturnType<typeof linkRows>; tags: string[] }> = [];
  for (const n of bodies) {
    const newBody = rewriteLinkTarget(n.body, fromTitle, toTitle);
    if (newBody === normalizeBody(n.body)) continue; // nothing real changed (e.g. only-in-code)
    const parsed = parseNote({ title: n.title, body: newBody });
    out.push({ id: n.id, title: n.title, body: parsed.body, links: linkRows(parsed.links), tags: parsed.tags });
  }
  return out;
}

/**
 * Merge note A (source) into note B (target): append A's content to B, repoint every inbound
 * `[[A]]`→`[[B]]` (alias/embed preserving), and soft-delete A — all in one transaction. A's
 * frontmatter/properties are dropped (only its content-after-frontmatter is appended; A's body
 * `#tags` ride along); B's properties are kept. Navigates the caller to B.
 */
export async function mergeNotes(sourceId: string, targetId: string): Promise<Result> {
  if (sourceId === targetId) return { ok: false, error: "error", message: "Cannot merge a note into itself." };
  try {
    const rows = await query<{ id: string; title: string; body: string }>(
      "select id, title, body from notes where id = any($1::uuid[]) and deleted_at is null",
      [[sourceId, targetId]],
    );
    const src = rows.find((n) => n.id === sourceId);
    const tgt = rows.find((n) => n.id === targetId);
    if (!src) return { ok: false, error: "error", message: "Source note not found." };
    if (!tgt) return { ok: false, error: "error", message: "Target note not found." };

    const linkers = await inboundLinkers(undefined, sourceId, src.title, src.title, tgt.title, [sourceId, targetId]);

    // B's merged body: B + blank line + A's content-after-frontmatter, then B's own [[A]]→[[B]].
    const normA = normalizeBody(src.body);
    const normB = normalizeBody(tgt.body);
    const aContent = normA.slice(parseFrontmatter(normA).contentStart).replace(/^\n+/, "");
    let merged: string;
    if (aContent.trim() === "") merged = normB;
    else if (normB.trim() === "") merged = aContent;
    else merged = normB.replace(/\n+$/, "") + "\n\n" + aContent;
    merged = rewriteLinkTarget(merged, src.title, tgt.title);
    const parsedB = parseNote({ title: tgt.title, body: merged });

    const row = await queryOne<{ note: Record<string, unknown> }>(
      "select merge_notes($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::text[], $7::jsonb) as note",
      [
        sourceId,
        targetId,
        tgt.title,
        parsedB.body,
        JSON.stringify(linkRows(parsedB.links)),
        parsedB.tags,
        JSON.stringify(linkers),
      ],
    );
    if (!row) throw new Error("merge_notes returned no row");
    return { ok: true, note: row.note };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Extract a selection into a NEW note, leaving `[[New Title]]` behind in the source. The CLIENT
 * computes the finished strings against its own editor doc (`sourceNewBody` = source body with
 * the selection replaced by the link; `newBody` = the selection verbatim) so offsets never reach
 * SQL. One atomic RPC: a duplicate new title (23505) aborts before the source is touched.
 */
export async function extractNote(input: {
  sourceId: string;
  sourceNewBody: string;
  newBody: string;
  newTitle: string;
}): Promise<Result> {
  const newTitle = input.newTitle.trim();
  if (!newTitle) return { ok: false, error: "error", message: "Title is required." };
  try {
    const src = await queryOne<{ id: string; title: string }>(
      "select id, title from notes where id = $1 and deleted_at is null",
      [input.sourceId],
    );
    if (!src) return { ok: false, error: "error", message: "Source note not found." };

    const parsedNew = parseNote({ title: newTitle, body: input.newBody });
    const parsedSrc = parseNote({ title: src.title, body: input.sourceNewBody });

    const row = await queryOne<{ note: Record<string, unknown> }>(
      `select extract_note($1::uuid, $2, $3, $4::jsonb, $5::text[], $6, $7, $8::jsonb, $9::text[], $10::jsonb, $11::uuid) as note`,
      [
        input.sourceId,
        src.title,
        parsedSrc.body,
        JSON.stringify(linkRows(parsedSrc.links)),
        parsedSrc.tags,
        newTitle,
        parsedNew.body,
        JSON.stringify(linkRows(parsedNew.links)),
        parsedNew.tags,
        JSON.stringify(parsedNew.properties),
        null,
      ],
    );
    if (!row) throw new Error("extract_note returned no row");
    return { ok: true, note: row.note };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Rename a note and cascade `[[Old]]`→`[[New]]` (alias/embed preserving) across every linking
 * note, transactionally. The note's body is unchanged. A title collision (23505)
 * aborts the whole transaction → duplicate_title (zero writes). Byte-equal title is a no-op; a
 * case-only change ("Foo"→"foo") proceeds and propagates the canonical casing to linkers.
 *
 * `oldTitle` is passed explicitly (the caller's pre-edit baseline), NOT read from the DB: the
 * per-keystroke title autosave has typically ALREADY set notes.title to the new value by the
 * time this runs, so the DB no longer knows the old title. The cascade needs the old title to
 * find the `[[Old]]` link text to rewrite (inbound rows are still target_id-linked to this note,
 * but their bodies still say `[[Old]]`).
 */
export async function renameNote(id: string, oldTitle: string, newTitleRaw: string): Promise<Result> {
  const newTitle = newTitleRaw.trim();
  if (!newTitle) return { ok: false, error: "error", message: "Title is required." };
  try {
    const note = await queryOne<{ id: string; title: string; body: string }>(
      "select id, title, body from notes where id = $1 and deleted_at is null",
      [id],
    );
    if (!note) return { ok: false, error: "error", message: "Note not found." };

    if (newTitle === oldTitle) return { ok: true, note };

    const linkers = await inboundLinkers(undefined, id, oldTitle, oldTitle, newTitle, [id]);
    const parsedSelf = parseNote({ title: newTitle, body: note.body });

    const row = await queryOne<{ note: Record<string, unknown> }>(
      "select rename_note($1::uuid, $2, $3, $4::jsonb, $5::text[], $6::jsonb) as note",
      [
        id,
        newTitle,
        parsedSelf.body,
        JSON.stringify(linkRows(parsedSelf.links)),
        parsedSelf.tags,
        JSON.stringify(linkers),
      ],
    );
    if (!row) throw new Error("rename_note returned no row");
    return { ok: true, note: row.note };
  } catch (e) {
    return fail(e);
  }
}
