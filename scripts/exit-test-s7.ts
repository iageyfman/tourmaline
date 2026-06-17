/**
 * Exit test — full-text search, via the REAL searchNotes server
 * action + parseSearchQuery, over notes seeded through the REAL save pipeline.
 *
 *   RANK/TSQUERY: title-weight (term in title outranks body-only); english stemming;
 *                 websearch phrase order; ts_headline snippet sentinels.
 *   OPERATORS:    tag: (descendants + LIKE-safety), path: (recursive folder subtree),
 *                 prop:key=value (string/boolean, case-insensitive, AND the missing-key
 *                 negative — BLOCKER-1), prop:key existence; AND-combination of text+tag.
 *   SAFETY:       operator-only (no tsquery error), empty→[], soft-delete excluded, junk
 *                 input never throws. Plus the 16 parseSearchQuery unit cases.
 *
 * Scoped to its own `S7 *` titles (the live vault holds ~30 unrelated notes). Run:
 *   npx tsx scripts/exit-test-s7.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { createFolder } from "../lib/folders/actions";
import { softDeleteNote } from "../lib/notes/actions";
import { searchNotes } from "../lib/search/actions";
import { parseSearchQuery } from "../lib/search/query";

const TITLES = [
  "S7 Alpha Title", "S7 Body Only", "S7 Meetings", "S7 Phrase",
  "S7 Toyota", "S7 Honda", "S7 Clientele", "S7 ClientNoWord",
  "S7 In Parent", "S7 In Sub", "S7 Elsewhere",
  "S7 Draft", "S7 Published", "S7 NoStatus",
];

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const titlesOf = (hits: { title: string }[]) => hits.map((h) => h.title);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const db = createClient();

  // Clean prior runs: notes by title, then the S7 folders by name (names aren't unique).
  await db.from("notes").delete().in("title", TITLES);
  await db.from("folders").delete().in("name", ["S7Folder", "S7Sub"]);

  const seed = async (title: string, body: string, folderId: string | null = null) =>
    (await saveNote(db, { title, body, folderId })).id as string;

  // ── Seed ─────────────────────────────────────────────────────────────────────
  const alphaTitleId = await seed("S7 Alpha Title", "ordinary body about felines");
  await seed("S7 Body Only", "this body mentions alpha exactly once");
  await seed("S7 Meetings", "we held several meetings today");
  await seed("S7 Phrase", "the quick brown fox jumps over");

  await seed("S7 Toyota", "#client/toyota note here");
  await seed("S7 Honda", "#client/honda note here");
  await seed("S7 Clientele", "#clientele note here");
  await seed("S7 ClientNoWord", "#client/toyota xyzzy"); // tag client, but no word "note"

  const pf = await createFolder({ name: "S7Folder" });
  const sf = await createFolder({ name: "S7Sub", parentId: pf.id });
  await seed("S7 In Parent", "parent folder note", pf.id);
  await seed("S7 In Sub", "sub folder note", sf.id);
  await seed("S7 Elsewhere", "unfiled note");

  await seed("S7 Draft", "---\nstatus: draft\ndone: true\n---\ndraft body");
  await seed("S7 Published", "---\nstatus: published\n---\npublished body");
  await seed("S7 NoStatus", "plain note, no frontmatter");

  // ── A. Ranking + tsquery basics ────────────────────────────────────────────────
  console.log("\n=== A. Ranking / stemming / phrase / snippet ===");
  const alpha = await searchNotes("alpha");
  const aT = titlesOf(alpha);
  check(aT.includes("S7 Alpha Title") && aT.includes("S7 Body Only"), "free-text 'alpha' finds the title-match AND the body-match");
  const rT = alpha.find((h) => h.title === "S7 Alpha Title")?.rank ?? 0;
  const rB = alpha.find((h) => h.title === "S7 Body Only")?.rank ?? 0;
  check(rT > rB, `title-weight: 'S7 Alpha Title' rank ${rT.toFixed(4)} > 'S7 Body Only' ${rB.toFixed(4)}`);

  check(titlesOf(await searchNotes("meeting")).includes("S7 Meetings"), "stemming: query 'meeting' matches 'meetings'");
  check(titlesOf(await searchNotes('"quick brown"')).includes("S7 Phrase"), 'phrase "quick brown" (in order) matches');
  check(!titlesOf(await searchNotes('"brown quick"')).includes("S7 Phrase"), 'phrase "brown quick" (wrong order) does NOT match');

  const snipHit = (await searchNotes("alpha")).find((h) => h.title === "S7 Body Only");
  check(!!snipHit && snipHit.snippet.includes("\uE000") && snipHit.snippet.includes("\uE001"), "snippet wraps the match in U+E000/U+E001 sentinels");

  // ── B. tag: operator ─────────────────────────────────────────────────────────
  console.log("\n=== B. tag: operator (descendants + LIKE-safety) ===");
  const tagClient = titlesOf(await searchNotes("tag:client"));
  check(tagClient.includes("S7 Toyota") && tagClient.includes("S7 Honda"), "tag:client includes client/toyota + client/honda (descendants)");
  check(!tagClient.includes("S7 Clientele"), "tag:client LIKE-safety: excludes 'clientele'");
  const tagToyota = titlesOf(await searchNotes("tag:client/toyota"));
  check(tagToyota.includes("S7 Toyota") && !tagToyota.includes("S7 Honda"), "tag:client/toyota matches toyota, excludes honda");

  // ── C. path: operator (recursive subtree) ──────────────────────────────────────
  console.log("\n=== C. path: operator (folder + recursive subtree) ===");
  const inPath = titlesOf(await searchNotes("path:S7Folder"));
  check(inPath.includes("S7 In Parent"), "path:S7Folder includes a note directly in that folder");
  check(inPath.includes("S7 In Sub"), "path:S7Folder includes a note in a SUBfolder (recursive)");
  check(!inPath.includes("S7 Elsewhere"), "path:S7Folder excludes an unfiled note");

  // ── D. prop: operator ──────────────────────────────────────────────────────────
  console.log("\n=== D. prop: operator (value match, existence, missing-key negative) ===");
  const draft = titlesOf(await searchNotes("prop:status=draft"));
  check(draft.includes("S7 Draft"), "prop:status=draft matches status=draft");
  check(!draft.includes("S7 Published"), "prop:status=draft excludes status=published");
  check(!draft.includes("S7 NoStatus"), "prop:status=draft excludes a note LACKING the key (BLOCKER-1 fix)");
  check(titlesOf(await searchNotes("prop:status=DRAFT")).includes("S7 Draft"), "prop value match is case-insensitive");
  check(titlesOf(await searchNotes("prop:done=true")).includes("S7 Draft"), "prop:done=true matches boolean-as-text");
  const hasStatus = titlesOf(await searchNotes("prop:status"));
  check(hasStatus.includes("S7 Draft") && hasStatus.includes("S7 Published"), "prop:status (existence) matches notes carrying the key");
  check(!hasStatus.includes("S7 NoStatus"), "prop:status existence excludes a note without the key");

  // ── E. AND-combination ───────────────────────────────────────────────────────
  console.log("\n=== E. text AND operator (intersection, not union) ===");
  const andQ = titlesOf(await searchNotes("note tag:client"));
  check(andQ.includes("S7 Toyota"), "'note tag:client' includes a note matching BOTH");
  check(!andQ.includes("S7 Clientele"), "AND: excludes a note matching the text but the wrong tag");
  check(!andQ.includes("S7 ClientNoWord"), "AND: excludes a note matching the tag but not the text");

  // ── F/G. Operator-only, empty, junk ────────────────────────────────────────────
  console.log("\n=== F. Operator-only / empty / junk ===");
  check((await searchNotes("tag:client")).length > 0, "operator-only search (no free text) returns rows, no tsquery error");
  check((await searchNotes("")).length === 0, "empty query → [] (never hits the DB)");
  check((await searchNotes("   ")).length === 0, "whitespace-only query → []");
  let threw = false;
  let junk: unknown[] = [];
  try {
    junk = await searchNotes("foo & | !");
  } catch {
    threw = true;
  }
  check(!threw && Array.isArray(junk), "junk input 'foo & | !' never throws (websearch_to_tsquery is total)");

  // ── H. Soft-delete excluded ────────────────────────────────────────────────────
  console.log("\n=== H. Soft-deleted notes never appear ===");
  await softDeleteNote(alphaTitleId);
  check(!titlesOf(await searchNotes("alpha")).includes("S7 Alpha Title"), "soft-deleted note drops out of search results");

  // ── I. parseSearchQuery unit cases ─────────────────────────────────────────────
  console.log("\n=== I. parseSearchQuery (16 unit cases) ===");
  const c = (raw: string, want: ReturnType<typeof parseSearchQuery>) =>
    check(eq(parseSearchQuery(raw), want), `parse ${JSON.stringify(raw)} → ${JSON.stringify(want)}`);
  c("meeting notes", { text: "meeting notes", tag: null, path: null, props: [] });
  c("tag:client", { text: "", tag: "client", path: null, props: [] });
  c("alpha tag:x", { text: "alpha", tag: "x", path: null, props: [] });
  c("tag:a tag:b", { text: "", tag: "a", path: null, props: [] });
  c('path:"Meeting Notes" agenda', { text: "agenda", tag: null, path: "Meeting Notes", props: [] });
  c("prop:status=draft", { text: "", tag: null, path: null, props: [{ key: "status", value: "draft" }] });
  c('prop:status="in progress"', { text: "", tag: null, path: null, props: [{ key: "status", value: "in progress" }] });
  c("prop:done=true", { text: "", tag: null, path: null, props: [{ key: "done", value: "true" }] });
  c("prop:archived", { text: "", tag: null, path: null, props: [{ key: "archived", value: null }] });
  c("prop:a=1 prop:b=2", { text: "", tag: null, path: null, props: [{ key: "a", value: "1" }, { key: "b", value: "2" }] });
  c('"quoted phrase"', { text: '"quoted phrase"', tag: null, path: null, props: [] });
  c("tag:client prop:p=1 hello world", { text: "hello world", tag: "client", path: null, props: [{ key: "p", value: "1" }] });
  c("  tag:a    foo   bar ", { text: "foo bar", tag: "a", path: null, props: [] });
  c("", { text: "", tag: null, path: null, props: [] });
  c("prop:k=", { text: "", tag: null, path: null, props: [{ key: "k", value: "" }] });
  c("see https://foo", { text: "see https://foo", tag: null, path: null, props: [] });

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
