/**
 * Exit test — wiki-link data + autocomplete-source half.
 * Seeds "Alpha" (exists) and "Source" (links to Alpha, an unresolved [[Future]], an alias,
 * and a [[NotALink]] inside a code block). Dumps Source's link rows (proving resolution +
 * code exclusion at the data layer) and unit-checks the wiki autocomplete source.
 *
 * "Future" is deliberately NOT created here — the running app demonstrates create-on-click,
 * and the claim is then verified against the DB. Run: npx tsx scripts/exit-test-s3.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { saveNote } from "../lib/pipeline/save-note";
import { wikiComplete } from "../lib/editor/wiki-complete";

const TITLES = ["Alpha", "Source", "Future"];

const SOURCE_BODY = [
  "---",
  "title: Source",
  "---",
  "",
  "Resolved link: [[Alpha]]",
  "Unresolved link: [[Future]]",
  "Aliased link: [[Alpha|see alpha]]",
  "",
  "```",
  "[[NotALink]] must NOT become a link (it is inside a code block).",
  "```",
  "",
].join("\n");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env (SUPABASE_SERVICE_ROLE_KEY in .env.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  await db.from("notes").delete().in("title", TITLES); // repeatable

  await saveNote(db, { title: "Alpha", body: "The alpha note." });
  const source = await saveNote(db, { title: "Source", body: SOURCE_BODY });
  const sourceId = source.id as string;

  console.log("\n=== SEED: Source link rows (pipeline result) ===");
  const { data: links } = await db
    .from("links")
    .select("target_title, target_id, is_embed, position")
    .eq("source_id", sourceId)
    .order("position");
  console.table(links);
  console.log("Expect: [[Alpha]] + [[Alpha|see alpha]] resolved (target_id set), [[Future]] null,");
  console.log("and NO row for [[NotALink]] (it was inside a code block).");

  console.log("\n=== AUTOCOMPLETE SOURCE — unit check ===");
  const titlesRef = { current: ["Alpha", "Beta", "Gamma"] };
  const source1 = wikiComplete(titlesRef);
  // Fake a CompletionContext whose matchBefore reports the cursor is just after `[[al`.
  const hit = source1({ matchBefore: () => ({ from: 10, to: 14, text: "[[al" }) } as never);
  console.log("after '[[al': from =", hit?.from, "(expect 12)  options =", hit?.options.map((o) => o.label));
  const miss = source1({ matchBefore: () => null } as never);
  console.log("with no open '[[':", miss, "(expect null)");

  console.log("\nDone (Future intentionally not created — the app demonstrates create-on-click).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
