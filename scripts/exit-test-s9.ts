/**
 * Exit test — embeds + bookmarks + outline + outgoing links,
 * via the REAL server actions over an `S9 *` topology seeded through the REAL save pipeline, plus
 * the pure helper units. Browser-only behaviors (the embed FRAME, the depth-1 placeholder, the
 * outline click-scroll, the bookmark star + drag-reorder) are verified separately in the app; this
 * asserts the data/logic those renders consume.
 *
 *   OUTGOING (3.6):  getOutgoingLinks("S9 Embed Source") splits resolved vs unresolved, DEDUPS a
 *                    target linked 3× (2 embeds + 1 plain) into one resolved row tagged embed,
 *                    keeps "S9 Other" (plain) + "S9 Missing" (unresolved); a soft-deleted target
 *                    drops out (trashed-hidden).
 *   EMBEDS (3.3):    getNoteBodies(targetId) returns the target body (what EmbedBox renders);
 *                    extractEmbedTitles masks code + ignores plain [[ ]].
 *   OUTLINE (3.5):   extractHeadings = ATX only, code-masked, dup-slug suffixed, line indices.
 *   BOOKMARKS (3.4): toggle idempotency, search/heading add, reorder persistence, remove.
 *
 * Scoped to its own `S9 *` titles. Run:  npx tsx scripts/exit-test-s9.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { softDeleteNote, getNoteBodies } from "../lib/notes/actions";
import { getOutgoingLinks } from "../lib/links/actions";
import { extractEmbedTitles } from "../lib/links/embeds";
import { extractHeadings, slugify } from "../lib/outline/headings";
import {
  listBookmarks,
  addBookmark,
  removeBookmark,
  reorderBookmarks,
  toggleNoteBookmark,
  type Bookmark,
} from "../lib/bookmarks/actions";

const TITLES = ["S9 Embed Target", "S9 Other", "S9 Headings", "S9 Embed Source"];

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const HEADINGS_BODY = ["# A", "## B", "", "```", "# InCode", "```", "# A"].join("\n");

async function main() {
  const db = createClient();

  // Clean prior runs: deleting the S9 notes cascades their note/heading bookmarks (FK on delete
  // cascade); search bookmarks (note_id null) are cleaned by label.
  await db.from("notes").delete().in("title", TITLES);
  await db.from("bookmarks").delete().like("label", "S9 %");

  const seed = async (title: string, body: string) =>
    (await saveNote(db, { title, body })).id as string;

  // Seed targets BEFORE the source so the source's links resolve immediately.
  const targetId = await seed(
    "S9 Embed Target",
    "# Target H1\n\n## Target H2\n\nnested embed: ![[S9 Embed Source]]",
  );
  const otherId = await seed("S9 Other", "just another note");
  const headingsId = await seed("S9 Headings", HEADINGS_BODY);
  const sourceId = await seed(
    "S9 Embed Source",
    "![[S9 Embed Target]]\n\nsee ![[S9 Embed Target]] here, a plain [[S9 Embed Target]], [[S9 Missing]], and [[S9 Other]]",
  );

  // ── A. Outgoing links (3.6) ───────────────────────────────────────────────────────
  console.log("\n=== A. Outgoing links: split / dedup / embed-tag / trashed-hidden ===");
  const out = await getOutgoingLinks(sourceId);
  check(out.resolved.length === 2, `2 resolved targets (deduped), got ${out.resolved.length}`);
  check(
    eq(out.resolved.map((r) => r.title), ["S9 Embed Target", "S9 Other"]),
    "resolved titles = [S9 Embed Target, S9 Other], sorted",
  );
  const tgt = out.resolved.find((r) => r.title === "S9 Embed Target");
  check(tgt?.isEmbed === true, "target linked 3× (2 embed + 1 plain) → ONE row, tagged embed");
  check(out.resolved.find((r) => r.title === "S9 Other")?.isEmbed === false, "plain-only target not tagged embed");
  check(eq(out.unresolved.map((u) => u.title), ["S9 Missing"]), "unresolved = [S9 Missing]");

  await softDeleteNote(otherId); // its resolved outgoing row must drop out
  const out2 = await getOutgoingLinks(sourceId);
  check(
    eq(out2.resolved.map((r) => r.title), ["S9 Embed Target"]),
    "after soft-deleting S9 Other, it disappears from resolved (trashed-hidden)",
  );

  // ── B. Embed data (3.3) ────────────────────────────────────────────────────────────
  console.log("\n=== B. Embed data: getNoteBodies + extractEmbedTitles ===");
  const bodies = await getNoteBodies([targetId]);
  check(bodies.length === 1 && bodies[0].id === targetId, "getNoteBodies returns the target note");
  check(!!bodies[0]?.body.includes("# Target H1"), "embed target body carries its rendered content");
  check(eq(await getNoteBodies([]), []), "getNoteBodies([]) short-circuits to []");

  const titles = extractEmbedTitles(
    "![[Alpha]]\n`![[InlineCode]]`\n```\n![[Fenced]]\n```\nsee ![[Alpha]] and [[NotEmbed]]",
  );
  check(eq(titles.sort(), ["alpha"]), "extractEmbedTitles: dedup+lowercase, mask inline/fenced code, ignore plain [[ ]]");

  // ── C. Outline (3.5) ───────────────────────────────────────────────────────────────
  console.log("\n=== C. Outline: extractHeadings (ATX, code-masked, dup-slug) ===");
  const hs = extractHeadings(HEADINGS_BODY);
  check(eq(hs.map((h) => h.level), [1, 2, 1]), "levels = [1,2,1]");
  check(eq(hs.map((h) => h.text), ["A", "B", "A"]), "texts = [A,B,A]");
  check(eq(hs.map((h) => h.slug), ["a", "b", "a-1"]), "slugs = [a,b,a-1] (duplicate suffixed)");
  check(eq(hs.map((h) => h.line), [0, 1, 6]), "line indices = [0,1,6] (# InCode in the fence excluded)");
  check(!hs.some((h) => h.text === "InCode"), "fenced '# InCode' is NOT a heading");
  check(slugify("Hello, World!") === "hello-world", "slugify strips punctuation → hello-world");
  check(slugify("  Multiple   Spaces  ") === "multiple-spaces", "slugify collapses spaces");
  check(slugify("***") === "section", "slugify('***') → 'section' fallback");

  // ── D. Bookmarks (3.4) ─────────────────────────────────────────────────────────────
  console.log("\n=== D. Bookmarks: toggle idempotency / add / reorder / remove ===");
  const noteBmsFor = async (id: string) =>
    (await listBookmarks()).filter((b) => b.kind === "note" && b.note_id === id);

  const on = await toggleNoteBookmark(sourceId, "S9 Embed Source");
  check(on.ok && on.bookmarked === true, "toggleNoteBookmark → starred");
  check((await noteBmsFor(sourceId)).length === 1, "exactly one note bookmark after starring");
  const off = await toggleNoteBookmark(sourceId);
  check(off.ok && off.bookmarked === false, "toggle again → unstarred");
  check((await noteBmsFor(sourceId)).length === 0, "toggle is idempotent: never leaves a duplicate");

  const bmId = (r: { ok: true; bookmark: Bookmark } | { ok: false; message: string }): string => {
    if (!r.ok) throw new Error("addBookmark failed: " + r.message);
    return r.bookmark.id;
  };
  const idNote = bmId(await addBookmark({ kind: "note", noteId: sourceId, label: "S9 bm note" }));
  const idSearch = bmId(await addBookmark({ kind: "search", payload: { query: "tag:s9" }, label: "S9 bm search" }));
  const idHeading = bmId(
    await addBookmark({ kind: "heading", noteId: headingsId, payload: { slug: "a", text: "A" }, label: "S9 bm heading" }),
  );
  const ids = [idNote, idSearch, idHeading];

  const orderOf = async () => (await listBookmarks()).filter((b) => ids.includes(b.id)).map((b) => b.id);
  const r = await reorderBookmarks([idHeading, idNote, idSearch]);
  check(r.ok, "reorderBookmarks ok");
  check(eq(await orderOf(), [idHeading, idNote, idSearch]), "reorder persists (relative order of our 3 bookmarks)");

  const rm = await removeBookmark(idNote);
  check(rm.ok, "removeBookmark ok");
  const after = await orderOf();
  check(!after.includes(idNote) && after.length === 2, "removed bookmark is gone; the other two remain");

  // ── Cleanup ────────────────────────────────────────────────────────────────────────
  await db.from("bookmarks").delete().in("id", ids); // search bookmark won't cascade with notes
  await db.from("notes").delete().in("title", TITLES); // cascades remaining note/heading bookmarks
  await db.from("bookmarks").delete().like("label", "S9 %");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
