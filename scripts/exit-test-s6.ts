/**
 * Exit test — tags + tag pane and properties panel.
 *
 *   TAGS:  distinct-note counts; nested tree; descendant notesByTag; LIKE-safety
 *          (no over-match on `_`/prefix); orphan + soft-delete exclusion.
 *   PROPS: set/delete round-trip through YAML → pipeline → notes.properties (read back
 *          from the DB, proving the pipeline re-derived); boolean/date/array/special-char
 *          typing; no-frontmatter prepend at byte 0; content-below-frontmatter integrity;
 *          invalid-YAML write refusal; comment/order preservation.
 *
 * Run: npx tsx scripts/exit-test-s6.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { parseFrontmatter } from "../lib/pipeline/parse";
import { softDeleteNote } from "../lib/notes/actions";
import { listTagsWithCounts, notesByTag } from "../lib/tags/actions";
import { buildTagTree } from "../lib/tags/tree";
import { setNoteProperty, deleteNoteProperty } from "../lib/properties/actions";

const TITLES = [
  "S6 Toyota", "S6 Honda", "S6 Client", "S6 Dup", "S6 Clientele", "S6 Underscore", "S6 Decoy",
  "S6 Props", "S6 Content", "S6 Broken", "S6 Order",
];

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

async function main() {
  const db = createClient();
  await db.from("notes").delete().in("title", TITLES);

  const seed = async (title: string, body: string) => {
    const n = await saveNote(db, { title, body });
    return n.id as string;
  };
  const row = async (id: string) => {
    const { data } = await db.from("notes").select("body, properties").eq("id", id).single();
    return data as unknown as { body: string; properties: Record<string, unknown> };
  };
  const tagNamesOf = async (id: string) => {
    const { data: nt } = await db.from("note_tags").select("tag_id").eq("note_id", id);
    const { data: t } = await db.from("tags").select("name").in("id", (nt ?? []).map((r) => r.tag_id));
    return (t ?? []).map((r) => r.name);
  };

  // ── A. Tags ────────────────────────────────────────────────────────────────
  console.log("\n=== A. Tag counts / tree / descendants / LIKE-safety ===");
  const toyotaId = await seed("S6 Toyota", "#client/toyota");
  await seed("S6 Honda", "#client/honda");
  await seed("S6 Client", "bare #client tag");
  await seed("S6 Dup", "#client/toyota and again #client/toyota");
  await seed("S6 Clientele", "#clientele");
  await seed("S6 Underscore", "#a_b");
  await seed("S6 Decoy", "#axb");

  const tags = await listTagsWithCounts();
  const countOf = (name: string) => tags.find((t) => t.name === name)?.count;
  check(countOf("client/toyota") === 2, `client/toyota distinct-note count = 2 (got ${countOf("client/toyota")})`);
  check(countOf("client/honda") === 1, `client/honda count = 1 (got ${countOf("client/honda")})`);
  check(countOf("client") === 1, `bare client count = 1 (got ${countOf("client")})`);

  const tree = buildTagTree(tags);
  const clientNode = tree.find((n) => n.name === "client");
  const childNames = clientNode?.children.map((c) => c.name).sort() ?? [];
  check(JSON.stringify(childNames) === JSON.stringify(["client/honda", "client/toyota"]), `client node nests honda+toyota (got ${JSON.stringify(childNames)})`);
  check(clientNode?.ownCount === 1 && clientNode?.totalCount === 4, `client ownCount=1, totalCount=4 (1+2+1) (got own=${clientNode?.ownCount}, total=${clientNode?.totalCount})`);

  const byClient = (await notesByTag("client")).map((n) => n.title).sort();
  check(byClient.length === 4 && byClient.includes("S6 Toyota") && byClient.includes("S6 Client"), `notesByTag('client') = 4 incl descendants (got ${JSON.stringify(byClient)})`);
  check(!byClient.includes("S6 Clientele"), "LIKE-safety: 'clientele' NOT matched by 'client'");
  const byToyota = (await notesByTag("client/toyota")).map((n) => n.title).sort();
  check(byToyota.length === 2 && !byToyota.includes("S6 Honda"), `notesByTag('client/toyota') = 2, excludes honda (got ${JSON.stringify(byToyota)})`);
  const byUnderscore = (await notesByTag("a_b")).map((n) => n.title);
  check(byUnderscore.length === 1 && byUnderscore[0] === "S6 Underscore", `notesByTag('a_b') excludes 'axb' decoy (got ${JSON.stringify(byUnderscore)})`);

  // orphan: strip the only note carrying client/honda
  const hondaRow = await db.from("notes").select("id").eq("title", "S6 Honda").single();
  await saveNote(db, { id: hondaRow.data!.id as string, title: "S6 Honda", body: "no tags now" });
  check((await listTagsWithCounts()).find((t) => t.name === "client/honda") === undefined, "orphan tag client/honda gone after its note drops it");

  // soft-delete: the bare-#client note
  const clientRow = await db.from("notes").select("id").eq("title", "S6 Client").single();
  await softDeleteNote(clientRow.data!.id as string);
  check((await listTagsWithCounts()).find((t) => t.name === "client") === undefined, "bare 'client' tag gone after its note is soft-deleted");

  // ── B. Properties: round-trips through YAML → pipeline → notes.properties ───
  console.log("\n=== B. Property edits round-trip (read back from the DB) ===");
  const CONTENT = "Just content, no frontmatter.\n\nMore lines.";
  const propsId = await seed("S6 Props", CONTENT);

  let r = await setNoteProperty(propsId, "status", "draft");
  check(r.ok, "set status on a no-frontmatter note succeeded");
  let after = await row(propsId);
  check(after.body.startsWith("---\nstatus: draft\n---\n"), `frontmatter prepended at byte 0 (got ${JSON.stringify(after.body.slice(0, 30))})`);
  const cs = parseFrontmatter(after.body).contentStart;
  check(after.body.slice(cs) === CONTENT, "content below frontmatter is byte-intact");
  check(after.properties.status === "draft", "properties.status === 'draft'");

  await setNoteProperty(propsId, "done", true);
  after = await row(propsId);
  check(after.properties.done === true && typeof after.properties.done === "boolean", "boolean round-trips as a real boolean");

  await setNoteProperty(propsId, "due", "2026-06-13");
  after = await row(propsId);
  check(after.properties.due === "2026-06-13" && typeof after.properties.due === "string", "date round-trips as the STRING '2026-06-13'");

  await setNoteProperty(propsId, "tags", ["client/toyota", "zeta"]);
  after = await row(propsId);
  check(JSON.stringify(after.properties.tags) === JSON.stringify(["client/toyota", "zeta"]), `tags array round-trips (got ${JSON.stringify(after.properties.tags)})`);
  const propTags = await tagNamesOf(propsId);
  check(propTags.includes("client/toyota") && propTags.includes("zeta"), `note_tags rebuilt from the tags: array (got ${JSON.stringify(propTags)})`);

  await setNoteProperty(propsId, "note", 'value: with #hash "q"');
  after = await row(propsId);
  check(after.properties.note === 'value: with #hash "q"', "special-char string round-trips exactly (auto-quoted)");

  r = await deleteNoteProperty(propsId, "status");
  after = await row(propsId);
  check(!("status" in after.properties) && after.properties.done === true, "delete removes the key, leaves siblings");

  // ── C. Content integrity around links/tags/thematic-break ──────────────────
  console.log("\n=== C. Editing properties never corrupts the body's content ===");
  const contentBody = ["---", "k: 1", "---", "Has [[Welcome]] and #contenttag.", "", "---", "", "Below a thematic break."].join("\n");
  const contentId = await seed("S6 Content", contentBody);
  const contentStartBefore = parseFrontmatter((await row(contentId)).body).contentStart;
  const contentRegion = (await row(contentId)).body.slice(contentStartBefore);
  await setNoteProperty(contentId, "k2", "v");
  await deleteNoteProperty(contentId, "k");
  after = await row(contentId);
  check(after.body.slice(parseFrontmatter(after.body).contentStart) === contentRegion, "content region (links/#tag/--- break) unchanged across set+delete");
  const cLinks = await db.from("links").select("target_title").eq("source_id", contentId);
  check((cLinks.data ?? []).some((l) => l.target_title === "Welcome"), "the [[Welcome]] link row survived");
  check((await tagNamesOf(contentId)).includes("contenttag"), "the #contenttag tag survived");

  // ── D. Invalid YAML is write-protected ─────────────────────────────────────
  console.log("\n=== D. Invalid-YAML notes refuse property writes ===");
  const brokenBody = "---\nfoo: [unclosed\n---\n\nbody text";
  const brokenId = await seed("S6 Broken", brokenBody);
  check("_raw_error" in (await row(brokenId)).properties, "invalid YAML stored as _raw_error (save not blocked)");
  const refused = await setNoteProperty(brokenId, "x", 1);
  check(!refused.ok && refused.error === "invalid_yaml", "setNoteProperty REFUSED with invalid_yaml");
  check((await row(brokenId)).body === brokenBody, "the broken body was NOT rewritten");

  // ── E. Comment + key order preserved (parseDocument, not parse→stringify) ───
  console.log("\n=== E. Comments + key order survive an edit ===");
  const orderBody = ["---", "# my comment", "zeta: 1", "alpha: 2", "---", "content"].join("\n");
  const orderId = await seed("S6 Order", orderBody);
  await setNoteProperty(orderId, "zeta", 5);
  const ob = (await row(orderId)).body;
  check(ob.includes("# my comment"), "the YAML comment survived the edit");
  check(ob.indexOf("zeta:") < ob.indexOf("alpha:"), "key order (zeta before alpha) preserved");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
