/**
 * Exit test — note composer + the rename cascade, via the REAL
 * server actions over an `S12 *` topology seeded through the REAL save pipeline, plus the pure
 * rewriteLinkTarget units. Browser-only behaviors (Compose menu, Cmd+click nav, the modals,
 * the client-side extract guards) are verified separately in the app; this asserts the
 * data/logic those flows consume.
 *
 *   MERGE:   merge_notes appends A's content-after-frontmatter to B, rewrites every inbound
 *            [[A]]→[[B]] (alias/embed/case), soft-deletes A; A's body #tags ride along,
 *            frontmatter is dropped; code links are never rewritten; self/code excluded from
 *            backlinks; merge-into-self rejected.
 *   EXTRACT: extract_note creates a new note from a selection and replaces the selection with
 *            [[New]] (resolves in-txn), claims a pre-existing unresolved [[New]]; duplicate /
 *            blank title rejected with the source left untouched.
 *   RENAME:  rename_note rewrites [[Old]]→[[New]] across linkers (alias/embed/code-safe);
 *            case-only rename allowed + propagated; a collision → duplicate_title (no writes);
 *            byte-equal title is a no-op.
 *   PURE:    rewriteLinkTarget (every-occurrence RTL, alias, embed, case→canonical,
 *            code/frontmatter-safe, whole-title, idempotent, no-op).
 *
 * Scoped to its own `S12 *` titles. Run:  npx tsx scripts/exit-test-s12.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { getBacklinks, getOutgoingLinks } from "../lib/links/actions";
import { mergeNotes, extractNote, renameNote } from "../lib/links/composer";
import { rewriteLinkTarget } from "../lib/links/rewrite";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const countMatches = (s: string, sub: string) => s.split(sub).length - 1;

async function main() {
  const db = createClient();

  const clean = async () => {
    // ilike (case-insensitive) so the case-only-rename test's "s12 renamed" is also swept.
    await db.from("notes").delete().ilike("title", "S12 %"); // cascades revisions/links/note_tags
    await db.from("folders").delete().ilike("name", "S12 %");
  };
  await clean();

  const seed = async (title: string, body: string, folderId: string | null = null) =>
    (await saveNote(db, { id: null, title, body, folderId })).id as string;
  const bodyOf = async (id: string) =>
    ((await db.from("notes").select("body").eq("id", id).single()).data?.body as string) ?? "";
  const revCount = async (id: string) =>
    (await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", id)).count ?? -1;

  // ── MERGE topology around "S12 A" (source) → "S12 B" (target) ──────────────────────────
  const idA = await seed(
    "S12 A",
    "---\nstatus: draft\ntags: [fmonly]\n---\n\nAlpha body with #atag and a [[S12 C]] ref.",
  );
  const idB = await seed("S12 B", "Beta body links [[S12 A]]."); // B itself links A
  const idPlain = await seed("S12 LinkerPlain", "see [[S12 A]] here.");
  const idAlias = await seed("S12 LinkerAlias", "see [[S12 A|the alpha]] here.");
  const idEmbed = await seed("S12 LinkerEmbed", "![[S12 A]]");
  const idCode = await seed("S12 LinkerCode", "`[[S12 A]]` inline and\n```\n[[S12 A]]\n```\n");
  const idBoth = await seed("S12 LinkerBoth", "[[S12 A]] and [[S12 B]] together.");
  const idCase = await seed("S12 LinkerCase", "see [[s12 a]] (lowercased).");

  console.log("\n=== MERGE: merge_notes(A → B) appends body, rewrites inbound links, retires A ===");
  const merged = await mergeNotes(idA, idB);
  check(merged.ok && (merged.note.id as string) === idB, "mergeNotes ok and returns target B");

  const aRow = (await db.from("notes").select("deleted_at").eq("id", idA).single()).data;
  check(!!aRow?.deleted_at, "A is soft-deleted (deleted_at set)");

  const bBody = await bodyOf(idB);
  check(bBody.includes("Beta body links [[S12 B]]"), "B's own [[S12 A]] rewritten to [[S12 B]] (B linked A)");
  check(bBody.includes("Alpha body with #atag and a [[S12 C]] ref."), "A's content-after-frontmatter appended to B");
  check(!bBody.includes("status: draft") && !bBody.includes("fmonly"), "A's frontmatter dropped (not appended)");

  const bTags = ((await db.from("note_tags").select("tags(name)").eq("note_id", idB)).data ?? []) as Array<{
    tags: { name: string } | { name: string }[] | null;
  }>;
  const bTagNames = bTags.flatMap((r) => (Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : [])).map((t) => t.name);
  check(bTagNames.includes("atag"), "B gained A's body tag #atag (rode along)");
  check(!bTagNames.includes("fmonly"), "B did NOT gain A's frontmatter tag (frontmatter dropped)");

  const bl = await getBacklinks(idB);
  const blTitles = bl.map((b) => b.sourceTitle);
  check(blTitles.includes("S12 LinkerPlain"), "backlinks(B) includes the plain linker");
  check(blTitles.includes("S12 LinkerAlias"), "backlinks(B) includes the alias linker");
  check(blTitles.includes("S12 LinkerEmbed"), "backlinks(B) includes the embed linker");
  check(blTitles.includes("S12 LinkerBoth"), "backlinks(B) includes the both linker");
  check(blTitles.includes("S12 LinkerCase"), "backlinks(B) includes the case linker");
  check(!blTitles.includes("S12 LinkerCode"), "backlinks(B) EXCLUDES the code-only linker");
  check(!blTitles.includes("S12 B"), "backlinks(B) EXCLUDES the self-link created by the merge");

  check((await bodyOf(idPlain)).includes("[[S12 B]]"), "plain linker rewritten [[S12 A]]→[[S12 B]]");
  check((await bodyOf(idAlias)).includes("[[S12 B|the alpha]]"), "alias linker preserves the alias");
  check((await bodyOf(idEmbed)).includes("![[S12 B]]"), "embed linker preserves the ! (embed)");
  check((await bodyOf(idCase)).includes("[[S12 B]]"), "case linker rewritten to canonical [[S12 B]]");
  check(countMatches(await bodyOf(idBoth), "[[S12 B]]") === 2, "both linker now has [[S12 B]] twice");
  const codeBody = await bodyOf(idCode);
  check(codeBody.includes("[[S12 A]]") && !codeBody.includes("[[S12 B]]"), "code-only linker is UNTOUCHED");

  const plainOut = await getOutgoingLinks(idPlain);
  check(plainOut.resolved.some((r) => r.title === "S12 B"), "rewritten linker's outgoing link resolves to B");

  const selfMerge = await mergeNotes(idB, idB);
  check(!selfMerge.ok, "merge-into-self is rejected");

  // ── EXTRACT topology ──────────────────────────────────────────────────────────────────
  console.log("\n=== EXTRACT: extract_note carves a selection into a new note, leaves [[link]] ===");
  const extBody = "Intro line.\nKEEP_THIS extracted chunk here.\nOutro line.";
  const idExt = await seed("S12 Ext", extBody);
  await seed("S12 ExtRef", "points to [[S12 NewNote]] before it exists."); // stale unresolved → claimed on create

  const sel = "KEEP_THIS extracted chunk here.";
  const from = extBody.indexOf(sel);
  const to = from + sel.length;
  const sourceNewBody = extBody.slice(0, from) + "[[S12 NewNote]]" + extBody.slice(to);
  const extracted = await extractNote({ sourceId: idExt, sourceNewBody, newBody: sel, newTitle: "S12 NewNote" });
  check(extracted.ok, "extractNote ok");
  check(extracted.ok && (extracted.note.title as string) === "S12 NewNote", "new note has the given title");
  check(extracted.ok && (extracted.note.body as string) === sel, "new note body === the selection");
  const newId = extracted.ok ? (extracted.note.id as string) : "";

  check((await bodyOf(idExt)) === "Intro line.\n[[S12 NewNote]]\nOutro line.", "source selection replaced by [[S12 NewNote]]");
  const extOut = await getOutgoingLinks(idExt);
  check(extOut.resolved.some((r) => r.title === "S12 NewNote"), "source's new link resolves to the new note (in-txn)");
  const newBl = (await getBacklinks(newId)).map((b) => b.sourceTitle);
  check(newBl.includes("S12 Ext"), "backlinks(new) includes the source");
  check(newBl.includes("S12 ExtRef"), "backlinks(new) includes the pre-existing unresolved ref (claimed on create)");

  const idExtDup = await seed("S12 ExtDup", "some content to extract into a dup.");
  const dupExtract = await extractNote({
    sourceId: idExtDup,
    sourceNewBody: "some [[S12 B]] to extract into a dup.",
    newBody: "content",
    newTitle: "S12 B", // already live (merge target) → collision
  });
  check(!dupExtract.ok && dupExtract.error === "duplicate_title", "extract into a taken title → duplicate_title");
  check((await bodyOf(idExtDup)) === "some content to extract into a dup.", "source untouched after a failed extract (atomic)");
  const blankExtract = await extractNote({ sourceId: idExtDup, sourceNewBody: "x", newBody: "y", newTitle: "   " });
  check(!blankExtract.ok, "extract with a blank title is rejected");

  // ── RENAME cascade topology ───────────────────────────────────────────────────────────
  console.log("\n=== RENAME: rename_note cascades [[Old]]→[[New]] across linkers ===");
  const idOld = await seed("S12 Old", "I am the old note.");
  const idRPlain = await seed("S12 RPlain", "link [[S12 Old]] here.");
  const idRAlias = await seed("S12 RAlias", "[[S12 Old|nickname]]");
  const idREmbed = await seed("S12 REmbed", "![[S12 Old]]");
  const idRCode = await seed("S12 RCode", "`[[S12 Old]]`");

  const renamed = await renameNote(idOld, "S12 Old", "S12 Renamed");
  check(renamed.ok && (renamed.note.title as string) === "S12 Renamed", "renameNote ok, title is S12 Renamed");
  check((await bodyOf(idOld)) === "I am the old note.", "renamed note's body is unchanged");
  check((await bodyOf(idRPlain)).includes("[[S12 Renamed]]"), "plain linker rewritten [[S12 Old]]→[[S12 Renamed]]");
  check((await bodyOf(idRAlias)).includes("[[S12 Renamed|nickname]]"), "alias linker preserves the alias");
  check((await bodyOf(idREmbed)).includes("![[S12 Renamed]]"), "embed linker preserves the !");
  check((await bodyOf(idRCode)) === "`[[S12 Old]]`", "code-only linker is UNTOUCHED");
  const oldBl = (await getBacklinks(idOld)).map((b) => b.sourceTitle).sort();
  check(
    oldBl.includes("S12 RPlain") && oldBl.includes("S12 RAlias") && oldBl.includes("S12 REmbed") && !oldBl.includes("S12 RCode"),
    "backlinks reflect the rewritten linkers (code excluded)",
  );

  // case-only rename propagates canonical casing
  const idRCase = await seed("S12 RCase", "ref [[S12 Renamed]] here.");
  const caseRename = await renameNote(idOld, "S12 Renamed", "s12 renamed");
  check(caseRename.ok && (caseRename.note.title as string) === "s12 renamed", "case-only rename succeeds (no self-collision)");
  check((await bodyOf(idRCase)).includes("[[s12 renamed]]"), "case-only rename propagates canonical casing to linkers");

  // collision → duplicate_title, no writes
  const idTaken = await seed("S12 Taken", "i am taken");
  const idOther = await seed("S12 Other", "rename me into a taken title");
  const idOtherLinker = await seed("S12 OtherLinker", "[[S12 Other]]");
  const beforeRevs = await revCount(idOther);
  const collide = await renameNote(idOther, "S12 Other", "S12 Taken");
  check(!collide.ok && collide.error === "duplicate_title", "rename into a taken title → duplicate_title");
  check(((await db.from("notes").select("title").eq("id", idOther).single()).data?.title as string) === "S12 Other", "the note keeps its old title");
  check((await bodyOf(idOtherLinker)) === "[[S12 Other]]", "no linker body changed on the failed rename");
  check((await revCount(idOther)) === beforeRevs, "no revision written on the failed rename");

  const noop = await renameNote(idTaken, "S12 Taken", "S12 Taken");
  check(noop.ok, "byte-equal rename is a no-op (ok)");

  // ── PURE UNITS: rewriteLinkTarget ─────────────────────────────────────────────────────
  console.log("\n=== PURE: rewriteLinkTarget ===");
  check(rewriteLinkTarget("see [[Foo]] and [[Foo]]", "Foo", "Bar") === "see [[Bar]] and [[Bar]]", "every occurrence (right-to-left)");
  check(rewriteLinkTarget("[[Foo|x]]", "Foo", "Bar") === "[[Bar|x]]", "alias preserved");
  check(rewriteLinkTarget("![[Foo]]", "Foo", "Bar") === "![[Bar]]", "embed bang preserved");
  check(rewriteLinkTarget("[[foo]]", "Foo", "Bar") === "[[Bar]]", "case-insensitive match → canonical case written");
  check(rewriteLinkTarget("`[[Foo]]`\n\n[[Foo]]", "Foo", "Bar") === "`[[Foo]]`\n\n[[Bar]]", "inline-code occurrence untouched");
  check(rewriteLinkTarget("```\n[[Foo]]\n```\n[[Foo]]", "Foo", "Bar") === "```\n[[Foo]]\n```\n[[Bar]]", "fenced-code occurrence untouched");
  check(rewriteLinkTarget("---\nref: [[Foo]]\n---\n[[Foo]]", "Foo", "Bar") === "---\nref: [[Foo]]\n---\n[[Bar]]", "frontmatter occurrence untouched");
  check(rewriteLinkTarget("[[Foobar]]", "Foo", "Bar") === "[[Foobar]]", "whole-title only (Foobar not matched)");
  check(rewriteLinkTarget(rewriteLinkTarget("[[Foo]]", "Foo", "Bar"), "Foo", "Bar") === "[[Bar]]", "idempotent (second pass is a no-op)");
  check(rewriteLinkTarget("no links here", "Foo", "Bar") === "no links here", "no-op when nothing matches");

  await clean();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
