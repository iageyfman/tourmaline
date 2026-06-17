/**
 * Exit test — folders + notes DB-evidence half.
 * Drives the real server actions (folder CRUD, moveNote, create/update) and dumps rows.
 * The UI half (nesting/collapse/preview screenshots) is verified against the running app.
 *
 * Run: npx tsx scripts/exit-test-s2.ts   (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { createFolder, renameFolder, deleteFolder, moveNote, listFolders } from "../lib/folders/actions";
import { createNote, updateNote } from "../lib/notes/actions";

const TEST_FOLDERS = ["Projects", "Work", "Toyota", "Empty"];
const TEST_NOTES = ["Meeting notes", "Roaming note", "Editor demo", "Preview demo"];

function mustOk(res: { ok: true; note: Record<string, unknown> } | { ok: false; message: string }) {
  if (!res.ok) throw new Error(res.message);
  return res.note;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env (SUPABASE_SERVICE_ROLE_KEY in .env.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Repeatable cleanup (raw deletes bypass the refuse-if-non-empty guard).
  await db.from("notes").delete().in("title", TEST_NOTES);
  await db.from("folders").delete().in("name", TEST_FOLDERS);

  // STEP 1 — folders: create, subfolder, rename
  const projects = await createFolder({ name: "Projects" });
  const toyota = await createFolder({ name: "Toyota", parentId: projects.id });
  await renameFolder(projects.id, "Work"); // Projects -> Work
  mustOk(await createNote({ title: "Meeting notes", body: "kickoff", folderId: toyota.id }));
  const folders = (await listFolders()).filter((f) => f.name === "Work" || f.name === "Toyota");
  console.log("\n=== STEP 1: folders (create + subfolder + rename Projects->Work) ===");
  console.table(folders.map((f) => ({ id: f.id, name: f.name, parent_id: f.parent_id })));

  // STEP 3 — drag-move via moveNote, and prove it does NOT cut a revision
  const roamId = mustOk(await createNote({ title: "Roaming note", body: "I will move." })).id as string;
  const initial = await db.from("notes").select("folder_id").eq("id", roamId).single();
  const revsBefore = await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", roamId);
  await moveNote(roamId, toyota.id);
  const moved = await db.from("notes").select("folder_id, updated_at").eq("id", roamId).single();
  const revsAfter = await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", roamId);
  console.log("\n=== STEP 3: move 'Roaming note' (unfiled -> Toyota) ===");
  console.log("folder_id before:", initial.data?.folder_id, "-> after:", moved.data?.folder_id);
  console.log("Toyota id:", toyota.id, "| match:", moved.data?.folder_id === toyota.id);
  console.log("revisions before:", revsBefore.count, "after:", revsAfter.count, "(equal => move bypassed the pipeline)");

  // STEP 4 — edit -> autosave (updateNote) -> persist; single revision across autosaves
  const demoId = mustOk(await createNote({ title: "Editor demo", body: "v1" })).id as string; // revision #1
  await updateNote({ id: demoId, title: "Editor demo", body: "v2" });
  await updateNote({ id: demoId, title: "Editor demo", body: "v3 final" });
  const demoRow = await db.from("notes").select("body").eq("id", demoId).single();
  const demoRevs = await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", demoId);
  console.log("\n=== STEP 4: edit -> autosave -> persist ===");
  console.log("persisted body:", JSON.stringify(demoRow.data?.body), "(expect 'v3 final')");
  console.log("revision count:", demoRevs.count, "(expect 1 — 5min server debounce held across autosaves)");

  // A rich-markdown note for the Cmd+E preview screenshot (step 5). [[Some Link]] and
  // #planning must render as PLAIN TEXT in preview (link/tag interactivity comes later).
  const PREVIEW_BODY = [
    "# Heading One",
    "",
    "Some **bold** and *italic* text, then a list:",
    "",
    "- alpha",
    "- beta",
    "",
    "A wiki link [[Some Link]] and a tag #planning should appear as PLAIN TEXT here.",
    "",
    "```js",
    "const x = 42;",
    "```",
  ].join("\n");
  mustOk(await createNote({ title: "Preview demo", body: PREVIEW_BODY }));

  // STEP 6 — folder delete: refuse non-empty, allow empty, no notes destroyed
  console.log("\n=== STEP 6: folder delete semantics ===");
  try {
    await deleteFolder(toyota.id); // Toyota holds Meeting notes + Roaming note
    console.log("UNEXPECTED: non-empty Toyota was deleted");
  } catch (e) {
    console.log("refused deleting non-empty Toyota:", (e as Error).message);
  }
  const empty = await createFolder({ name: "Empty" });
  await deleteFolder(empty.id);
  const emptyGone = await db.from("folders").select("id").eq("id", empty.id).maybeSingle();
  console.log("empty folder deleted:", emptyGone.data === null);
  const survivors = await db.from("notes").select("title").in("title", TEST_NOTES).is("deleted_at", null);
  console.log("surviving notes (none destroyed):", (survivors.data ?? []).map((r) => r.title).sort());

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
