/**
 * Exit test — backlinks data + snippet-helper half.
 * Seeds Alpha + Source (Source links Alpha twice + has an unresolved [[Future]] + a
 * [[Alpha]] inside a code block). Verifies getBacklinks + backlinkSnippets (code excluded),
 * then the create-claim "money shot": creating Future makes Source a backlink of Future.
 *
 * The quick switcher (1.7) is verified in-app (keyboard UI). Run: npx tsx scripts/exit-test-s4.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { getBacklinks } from "../lib/links/actions";
import { backlinkSnippets } from "../lib/links/snippets";

const TITLES = ["Alpha", "Source", "Future"];

const SOURCE_BODY = [
  "Resolved: [[Alpha]]",
  "Aliased: [[Alpha|see alpha]]",
  "Unresolved: [[Future]]",
  "",
  "```",
  "[[Alpha]] inside a code block must NOT count as a backlink.",
  "```",
].join("\n");

async function main() {
  const db = createClient();
  await db.from("notes").delete().in("title", TITLES); // repeatable

  const alpha = await saveNote(db, { title: "Alpha", body: "The alpha note." });
  const alphaId = alpha.id as string;
  await saveNote(db, { title: "Source", body: SOURCE_BODY });

  console.log("\n=== STEP 1: getBacklinks('Alpha') ===");
  const blAlpha = await getBacklinks(alphaId);
  console.dir(blAlpha, { depth: null });
  console.log("Expect: one source 'Source' with 2 snippets ([[Alpha]] + alias), NONE from the code block.");

  console.log("\n=== backlinkSnippets() unit check ===");
  console.log("snippets for 'Alpha':", backlinkSnippets(SOURCE_BODY, "Alpha"));
  console.log("(expect the 2 real lines; the alias line matches on base title 'Alpha'; no code line)");

  console.log("\n=== STEP 2 (money shot): create 'Future' -> Source becomes a backlink ===");
  const future = await saveNote(db, { title: "Future", body: "Now exists." });
  const futureId = future.id as string;
  const blFuture = await getBacklinks(futureId);
  console.dir(blFuture, { depth: null });
  console.log("Expect: 'Source' appears (its [[Future]] link was claimed by save_note on create).");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
