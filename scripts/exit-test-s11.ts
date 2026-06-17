/**
 * Exit test — unlinked mentions + version history, via the REAL server
 * actions over an `S11 *` topology seeded through the REAL save pipeline, plus the pure helper
 * units. Browser-only behaviors (the panel render, the "Link" button, the history modal) are
 * verified separately in the app; this asserts the data/logic those renders consume.
 *
 *   4.2 MENTIONS:  getUnlinkedMentions finds plain-text title mentions but excludes existing
 *                  links, code, the note's own frontmatter, longer-word substrings, self, and
 *                  trashed sources. "Link it" rewrites them to [[Title]] (→ a backlink) and is
 *                  a no-op on a second click.
 *   4.3 HISTORY:   listRevisions / getRevision browse; restoreRevision applies an old revision
 *                  (title/body/properties), ALWAYS cuts a new revision (count grows, history
 *                  intact), preserves folder_id, and maps a title collision → duplicate_title.
 *   PURE UNITS:    findUnlinkedMentions (exclusions + boundary + case + regex-special),
 *                  linkMentionsInBody (right-to-left, idempotent, code/link-safe).
 *
 * Scoped to its own `S11 *` titles. Run:  npx tsx scripts/exit-test-s11.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { saveNote } from "../lib/pipeline/save-note";
import { softDeleteNote } from "../lib/notes/actions";
import { getBacklinks, getUnlinkedMentions, linkMention } from "../lib/links/actions";
import { listRevisions, getRevision, restoreRevision } from "../lib/revisions/actions";
import { findUnlinkedMentions, linkMentionsInBody } from "../lib/links/mentions";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const countMatches = (s: string, sub: string) => s.split(sub).length - 1;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env (SUPABASE_SERVICE_ROLE_KEY in .env.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const clean = async () => {
    await db.from("notes").delete().like("title", "S11 %"); // cascades revisions/links/note_tags
    await db.from("folders").delete().like("name", "S11 %");
  };
  await clean();

  const { data: folder, error: fErr } = await db
    .from("folders")
    .insert({ name: "S11 Folder" })
    .select("id")
    .single();
  if (fErr) throw new Error(fErr.message);

  const seed = async (title: string, body: string, folderId: string | null = null) =>
    (await saveNote(db, { id: null, title, body, folderId })).id as string;

  // ── 4.2 topology around "S11 Target" ──────────────────────────────────────────────────
  const targetId = await seed("S11 Target", "the canonical target note");
  const plainId = await seed("S11 Plain", "this note plainly mentions S11 Target in prose.");
  await seed("S11 Linked", "see [[S11 Target]] here.\n\n```\nS11 Target in a code block\n```\n");
  await seed("S11 Frontmatter", "---\nrelated: S11 Target\n---\n\njust a body without the phrase.");
  await seed("S11 Substring", "we discuss S11 Targeted plans here (longer word).");
  await seed("S11 Both", "links to [[S11 Target]] but also mentions S11 Target as plain text.");
  const trashedId = await seed("S11 Trashed", "trashed note mentioning S11 Target.");
  await softDeleteNote(trashedId);

  // ── A. getUnlinkedMentions parity ─────────────────────────────────────────────────────
  console.log("\n=== A. getUnlinkedMentions: plain-text only (excludes links/code/frontmatter/substring/self/trashed) ===");
  const mentions = await getUnlinkedMentions(targetId);
  const titlesOf = (ms: { sourceTitle: string }[]) => ms.map((m) => m.sourceTitle).sort();
  check(mentions.some((m) => m.sourceTitle === "S11 Plain"), "includes S11 Plain (plain-text mention)");
  check(mentions.some((m) => m.sourceTitle === "S11 Both"), "includes S11 Both (linked AND plain-mentioned → the plain one counts)");
  check(!mentions.some((m) => m.sourceTitle === "S11 Linked"), "EXCLUDES S11 Linked (only a [[link]] + code)");
  check(!mentions.some((m) => m.sourceTitle === "S11 Frontmatter"), "EXCLUDES S11 Frontmatter (title only in frontmatter)");
  check(!mentions.some((m) => m.sourceTitle === "S11 Substring"), "EXCLUDES S11 Substring (Targeted ≠ Target, word boundary)");
  check(!mentions.some((m) => m.sourceTitle === "S11 Target"), "EXCLUDES self");
  check(!mentions.some((m) => m.sourceTitle === "S11 Trashed"), "EXCLUDES soft-deleted source");
  const plainMention = mentions.find((m) => m.sourceTitle === "S11 Plain");
  check(
    !!plainMention && plainMention.snippets.some((s) => s.includes("S11 Target")),
    "carries the surrounding-line snippet",
  );

  // ── B. "Link it" loop ─────────────────────────────────────────────────────────────────
  console.log("\n=== B. linkMention: plain text → [[link]] → leaves mentions, joins backlinks; idempotent ===");
  const link1 = await linkMention(plainId, "S11 Target");
  check(link1.ok, "linkMention(S11 Plain → S11 Target) ok");

  const afterMentions = await getUnlinkedMentions(targetId);
  check(!afterMentions.some((m) => m.sourceTitle === "S11 Plain"), "after Link, S11 Plain is no longer an unlinked mention");
  check(afterMentions.some((m) => m.sourceTitle === "S11 Both"), "after Link, S11 Both is still an unlinked mention");

  const backlinks = await getBacklinks(targetId);
  check(backlinks.some((b) => b.sourceTitle === "S11 Plain"), "after Link, S11 Plain is now a backlink (resolved link)");

  const { data: plainAfter } = await db.from("notes").select("body").eq("id", plainId).single();
  const plainBody = (plainAfter?.body as string) ?? "";
  check(plainBody.includes("[[S11 Target]]"), "S11 Plain body now contains [[S11 Target]]");
  const link2 = await linkMention(plainId, "S11 Target");
  const { data: plainAfter2 } = await db.from("notes").select("body").eq("id", plainId).single();
  check(
    link2.ok && countMatches((plainAfter2?.body as string) ?? "", "[[S11 Target]]") === 1 && !((plainAfter2?.body as string) ?? "").includes("[[[["),
    "second Link is a no-op (no double-wrap)",
  );

  // ── C. Pure units ─────────────────────────────────────────────────────────────────────
  console.log("\n=== C. Pure units: findUnlinkedMentions / linkMentionsInBody ===");
  check(eq(findUnlinkedMentions("a plain Foo here", "Foo"), ["a plain Foo here"]), "findUnlinkedMentions returns the snippet line");
  check(findUnlinkedMentions("```\nFoo\n```", "Foo").length === 0, "excludes a fenced-code occurrence");
  check(findUnlinkedMentions("use `Foo` inline", "Foo").length === 0, "excludes an inline-code occurrence");
  check(findUnlinkedMentions("[[Foo]]", "Foo").length === 0, "excludes an existing [[link]]");
  check(findUnlinkedMentions("---\nx: Foo\n---\n\nbody", "Foo").length === 0, "excludes the note's own frontmatter");
  check(findUnlinkedMentions("Foobar here", "Foo").length === 0, "excludes a longer-word substring (Foobar)");
  check(findUnlinkedMentions("foo here", "Foo").length === 1, "matches case-insensitively (foo ≈ Foo)");
  check(findUnlinkedMentions("axb here", "a.b").length === 0, "regex-special title is literal (a.b ≠ axb)");
  check(findUnlinkedMentions("a.b here", "a.b").length === 1, "regex-special title matches its literal (a.b)");

  check(linkMentionsInBody("see Foo and Foo", "Foo") === "see [[Foo]] and [[Foo]]", "wraps every plain occurrence (right-to-left)");
  check(linkMentionsInBody("see [[Foo]]", "Foo") === "see [[Foo]]", "idempotent: an already-linked occurrence is untouched");
  check(
    linkMentionsInBody("```\nFoo\n```\n\nplain Foo", "Foo") === "```\nFoo\n```\n\nplain [[Foo]]",
    "leaves code untouched, wraps only the plain occurrence",
  );

  // ── D. Version history: list / view / restore ─────────────────────────────────────────
  console.log("\n=== D. listRevisions / getRevision / restoreRevision (forces a revision, re-derives props) ===");
  const historyId = await seed("S11 History", "---\nstatus: current\n---\n\nversion one body", folder.id);
  // Direct-insert an OLDER revision (the only way past the 5-min debounce in a fast test).
  const { data: oldRev, error: orErr } = await db
    .from("note_revisions")
    .insert({
      note_id: historyId,
      title: "S11 History",
      body: "---\nstatus: old\n---\n\nversion zero body",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (orErr) throw new Error(orErr.message);
  const oldRevId = oldRev.id as string;

  const revs = await listRevisions(historyId);
  check(revs.length === 2, "listRevisions returns both revisions");
  check(
    revs.length === 2 && new Date(revs[0].created_at) > new Date(revs[1].created_at),
    "newest-first ordering",
  );
  const viewedOld = await getRevision(oldRevId);
  check(viewedOld.body.includes("version zero body"), "getRevision returns the revision body");

  const restored = await restoreRevision(historyId, oldRevId);
  check(restored.ok, "restoreRevision ok");
  check(restored.ok && (restored.note.body as string).includes("version zero body"), "note.body is now the restored (v0) body");
  check(
    restored.ok && (restored.note.properties as Record<string, unknown>).status === "old",
    "note.properties re-derived from the restored frontmatter (status: old)",
  );
  check(restored.ok && (restored.note.folder_id as string) === folder.id, "folder_id preserved across restore");
  const { count: afterCount } = await db
    .from("note_revisions")
    .select("*", { count: "exact", head: true })
    .eq("note_id", historyId);
  check(afterCount === 3, "restore wrote a NEW revision (2 → 3; history not destroyed)");
  const revsAfter = await listRevisions(historyId);
  check(
    revsAfter.length === 3 && (await getRevision(revsAfter[0].id)).body.includes("version zero body"),
    "the restored content is the newest revision (head)",
  );

  // ── E. Restore title-collision ─────────────────────────
  console.log("\n=== E. restoreRevision collision → duplicate_title (no partial write) ===");
  const fooId = (await saveNote(db, { id: null, title: "S11 Foo", body: "original foo body" })).id as string;
  const { data: fooRevs } = await db.from("note_revisions").select("id, title").eq("note_id", fooId);
  const fooRevId = (fooRevs ?? [])[0].id as string; // the creation revision, title "S11 Foo"
  await saveNote(db, { id: fooId, title: "S11 Bar", body: "original foo body" }); // rename (debounce coalesces)
  await saveNote(db, { id: null, title: "S11 Foo", body: "a different second foo" }); // a NEW live "S11 Foo"

  const collision = await restoreRevision(fooId, fooRevId); // would set S11 Bar's title back to "S11 Foo"
  check(!collision.ok && collision.error === "duplicate_title", "restoring an old title that now collides → duplicate_title");
  const { data: barNote } = await db.from("notes").select("title, body").eq("id", fooId).single();
  check(barNote?.title === "S11 Bar" && barNote?.body === "original foo body", "the note is unchanged (no partial write)");
  const { count: barRevCount } = await db
    .from("note_revisions")
    .select("*", { count: "exact", head: true })
    .eq("note_id", fooId);
  check(barRevCount === 1, "no revision was written on the failed restore (history intact)");

  void titlesOf; // (kept for ad-hoc debugging)

  // ── Cleanup ───────────────────────────────────────────────────────────────────────────
  await clean();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
