"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
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
  db: SupabaseClient,
  noteId: string,
  title: string,
  fromTitle: string,
  toTitle: string,
  excludeIds: string[],
) {
  const { data: linkData, error } = await db
    .from("links")
    .select("source_id, target_id, target_title")
    .or(`target_id.eq.${noteId},target_id.is.null`);
  if (error) throw new Error(error.message);

  const titleLower = title.trim().toLowerCase();
  const excluded = new Set(excludeIds);
  const ids = new Set<string>();
  for (const row of (linkData ?? []) as Array<{ source_id: string; target_id: string | null; target_title: string }>) {
    if (excluded.has(row.source_id)) continue;
    if (row.target_id === noteId) ids.add(row.source_id);
    else if (row.target_id === null && (row.target_title ?? "").trim().toLowerCase() === titleLower)
      ids.add(row.source_id);
  }
  if (ids.size === 0) return [];

  const { data: bodies, error: bErr } = await db
    .from("notes")
    .select("id, title, body")
    .in("id", [...ids])
    .is("deleted_at", null);
  if (bErr) throw new Error(bErr.message);

  const out: Array<{ id: string; title: string; body: string; links: ReturnType<typeof linkRows>; tags: string[] }> = [];
  for (const n of (bodies ?? []) as Array<{ id: string; title: string; body: string }>) {
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
  const db = createServerClient();
  try {
    const { data: rows, error } = await db
      .from("notes")
      .select("id, title, body")
      .in("id", [sourceId, targetId])
      .is("deleted_at", null);
    if (error) return { ok: false, error: "error", message: error.message };
    const src = (rows ?? []).find((n) => n.id === sourceId) as { id: string; title: string; body: string } | undefined;
    const tgt = (rows ?? []).find((n) => n.id === targetId) as { id: string; title: string; body: string } | undefined;
    if (!src) return { ok: false, error: "error", message: "Source note not found." };
    if (!tgt) return { ok: false, error: "error", message: "Target note not found." };

    const linkers = await inboundLinkers(db, sourceId, src.title, src.title, tgt.title, [sourceId, targetId]);

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

    const { data, error: rErr } = await db.rpc("merge_notes", {
      p_source_id: sourceId,
      p_target_id: targetId,
      p_target_title: tgt.title,
      p_target_body: parsedB.body,
      p_target_links: linkRows(parsedB.links),
      p_target_tags: parsedB.tags,
      p_sources: linkers,
    });
    if (rErr) return fail(rErr);
    return { ok: true, note: data as Record<string, unknown> };
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
  const db = createServerClient();
  try {
    const { data: src, error } = await db
      .from("notes")
      .select("id, title")
      .eq("id", input.sourceId)
      .is("deleted_at", null)
      .single();
    if (error) return { ok: false, error: "error", message: error.message };
    if (!src) return { ok: false, error: "error", message: "Source note not found." };

    const parsedNew = parseNote({ title: newTitle, body: input.newBody });
    const parsedSrc = parseNote({ title: src.title as string, body: input.sourceNewBody });

    const { data, error: rErr } = await db.rpc("extract_note", {
      p_source_id: input.sourceId,
      p_source_title: src.title,
      p_source_body: parsedSrc.body,
      p_source_links: linkRows(parsedSrc.links),
      p_source_tags: parsedSrc.tags,
      p_new_title: newTitle,
      p_new_body: parsedNew.body,
      p_new_links: linkRows(parsedNew.links),
      p_new_tags: parsedNew.tags,
      p_new_properties: parsedNew.properties,
      p_new_folder_id: null,
    });
    if (rErr) return fail(rErr);
    return { ok: true, note: data as Record<string, unknown> };
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
  const db = createServerClient();
  try {
    const { data: note, error } = await db
      .from("notes")
      .select("id, title, body")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (error) return { ok: false, error: "error", message: error.message };
    if (!note) return { ok: false, error: "error", message: "Note not found." };

    if (newTitle === oldTitle) return { ok: true, note: note as Record<string, unknown> };

    const linkers = await inboundLinkers(db, id, oldTitle, oldTitle, newTitle, [id]);
    const parsedSelf = parseNote({ title: newTitle, body: note.body as string });

    const { data, error: rErr } = await db.rpc("rename_note", {
      p_id: id,
      p_new_title: newTitle,
      p_self_body: parsedSelf.body,
      p_self_links: linkRows(parsedSelf.links),
      p_self_tags: parsedSelf.tags,
      p_sources: linkers,
    });
    if (rErr) return fail(rErr);
    return { ok: true, note: data as Record<string, unknown> };
  } catch (e) {
    return fail(e);
  }
}
