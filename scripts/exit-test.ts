/**
 * Exit test for the save pipeline. Drives the REAL save pipeline (saveNote ->
 * save_note RPC) against the live DB for all 5 required scenarios and prints the
 * resulting rows as evidence. Repeatable: hard-deletes its test notes first.
 *
 * Run: npx tsx scripts/exit-test.ts   (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { saveNote } from "../lib/pipeline/save-note";

const TITLES = ["Welcome", "Project Kickoff", "Code Sample", "Nonexistent Page"];

const KICKOFF_BODY = [
  "---",
  "title: Project Kickoff",
  "status: active",
  "priority: 1",
  "tags: [planning, area/work]",
  "due: 2026-07-01",
  "---",
  "",
  "# Project Kickoff",
  "",
  "Links to [[Welcome]] and to [[Nonexistent Page]] (missing).",
  "Aliased link: [[Welcome|the welcome note]].",
  "",
  "![[Welcome]]",
  "",
  "Tags: #project #urgent #area/work",
  "",
].join("\n");

const CODE_BODY = [
  "---",
  "title: Code Sample",
  "---",
  "",
  "A real link [[Welcome]] and a real tag #documented.",
  "",
  "```js",
  'const a = "[[In Fenced Block]] and #fencedtag";',
  "```",
  "",
  "Inline: `[[Inline Link]] and #inlinetag` must be ignored.",
  "",
].join("\n");

async function dumpKickoffLinks(db: SupabaseClient, kickoffId: string, label: string) {
  const { data, error } = await db
    .from("links")
    .select("target_title, target_id, is_embed, position")
    .eq("source_id", kickoffId)
    .order("position");
  if (error) throw new Error(error.message);
  console.log(`\n--- ${label} ---`);
  console.table(data);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing env. Paste your service_role key into .env.local (SUPABASE_SERVICE_ROLE_KEY)."
    );
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Repeatable: hard-delete prior test notes (test-only; app code never hard-deletes).
  const { error: delErr } = await db.from("notes").delete().in("title", TITLES);
  if (delErr) throw new Error(`cleanup failed: ${delErr.message}`);

  // Step 1a: existing target so [[Welcome]] resolves.
  await saveNote(db, { title: "Welcome", body: "The welcome note." });

  // Step 1b: the main note (frontmatter + links + tags). Writes revision #1.
  const kickoff = await saveNote(db, { title: "Project Kickoff", body: KICKOFF_BODY });
  const kickoffId = kickoff.id as string;
  console.log("\n=== STEP 1+2: Project Kickoff created ===");
  console.log("note id:", kickoffId);
  console.log("properties JSONB:", JSON.stringify(kickoff.properties));
  await dumpKickoffLinks(db, kickoffId, "links (Nonexistent Page must be target_id=null)");

  // Step 3: links/tags inside fenced + inline code must NOT produce rows.
  const code = await saveNote(db, { title: "Code Sample", body: CODE_BODY });
  console.log("\n=== STEP 3: Code Sample created (code links/tags must be ignored) ===");
  console.log("note id:", code.id);

  // Step 5: save the same note again within 5 min -> debounced, no new revision.
  await saveNote(db, { id: kickoffId, title: "Project Kickoff", body: KICKOFF_BODY });
  const { count: revCount } = await db
    .from("note_revisions")
    .select("*", { count: "exact", head: true })
    .eq("note_id", kickoffId);
  console.log("\n=== STEP 5: saved Project Kickoff twice within 5 min ===");
  console.log("revision count (must be 1):", revCount);

  // Step 4: create the previously-missing note -> claims the still-unresolved link.
  await saveNote(db, { title: "Nonexistent Page", body: "Now I exist." });
  console.log("\n=== STEP 4: 'Nonexistent Page' created -> unresolved link claimed ===");
  await dumpKickoffLinks(db, kickoffId, "links (Nonexistent Page now has target_id)");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
