/**
 * Exit test — database-style views, via the REAL server actions over an
 * `S10 *` topology seeded through the REAL save pipeline, plus the pure helper units. Browser-only
 * behaviors (the table/card render, the column-picker chips, the typed inline cell editors, the
 * Table↔Cards toggle) are verified separately in the app; this asserts the data/logic those
 * renders consume.
 *
 *   PARITY (notes_for_view): runView splits by tag (+descendants, boundary-safe), path (+subtree),
 *                            and prop (AND, existence, equality); returns TYPED properties; hides
 *                            soft-deleted; empty filter = all live notes.
 *   CRUD:                    createView → listViews → updateView (jsonb round-trip) → deleteView.
 *   INLINE EDIT (the crux):  setNoteProperty re-derives notes.properties (type-stable: a number
 *                            stays a number) AND a re-run of notes_for_view reflects the change.
 *   PURE UNITS:              coerceCellValue (type-anchored), sortViewRows (numeric + missing-last),
 *                            unionPropertyKeys (excludes _raw/_raw_error).
 *
 * Scoped to its own `S10 *` titles/names. Run:  npx tsx scripts/exit-test-s10.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "./db";
import { saveNote } from "../lib/pipeline/save-note";
import { softDeleteNote } from "../lib/notes/actions";
import { setNoteProperty } from "../lib/properties/actions";
import { listViews, createView, updateView, deleteView, runView } from "../lib/views/actions";
import { coerceCellValue } from "../lib/views/coerce";
import { sortViewRows } from "../lib/views/sort";
import { unionPropertyKeys } from "../lib/views/columns";
import type { ViewRow } from "../lib/views/types";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const has = (rows: ViewRow[], title: string) => rows.some((r) => r.title === title);
const propsOf = (note: Record<string, unknown>) => note.properties as Record<string, unknown>;

async function main() {
  const db = createClient();

  // Clean prior runs (order: views by name, notes by title [cascades], folders by name).
  await db.from("views").delete().like("name", "S10 %");
  await db.from("notes").delete().like("title", "S10 %");
  await db.from("folders").delete().like("name", "S10 %");

  // Folders: S10 Parent → S10 Child (for path-subtree recursion).
  const { data: parentF, error: pErr } = await db
    .from("folders")
    .insert({ name: "S10 Parent" })
    .select("id")
    .single();
  if (pErr) throw new Error(pErr.message);
  const { data: childF, error: cErr } = await db
    .from("folders")
    .insert({ name: "S10 Child", parent_id: parentF.id })
    .select("id")
    .single();
  if (cErr) throw new Error(cErr.message);

  const seed = async (title: string, body: string, folderId: string | null = null) =>
    (await saveNote(db, { title, body, folderId })).id as string;

  const activeId = await seed("S10 Active", "---\nstatus: active\npriority: 2\n---\n\nactive note");
  await seed("S10 Draft", "---\nstatus: draft\ndone: false\n---\n\ndraft note");
  await seed("S10 Tagged", "tagged note #client/toyota");
  await seed("S10 Decoy", "decoy note #clientele");
  await seed("S10 Plain", "just plain text, no frontmatter");
  const brokenId = await seed("S10 Broken", "---\nfoo: [unclosed\n---\n\nbody text");
  await seed("S10 In Child", "a note inside the child folder", childF.id);
  const trashId = await seed("S10 Trash", "---\nstatus: active\n---\n\ntrashed");
  await softDeleteNote(trashId);

  // ── A. notes_for_view parity (via runView) ───────────────────────────────────────────
  console.log("\n=== A. runView / notes_for_view: tag / path / prop / typed / soft-delete / empty ===");
  const byTag = await runView({ tag: "client", path: null, props: [] });
  check(has(byTag, "S10 Tagged"), "tag:client includes descendant-tagged S10 Tagged");
  check(!has(byTag, "S10 Decoy"), "tag:client EXCLUDES S10 Decoy (#clientele boundary)");

  const byPath = await runView({ tag: null, path: "S10 Parent", props: [] });
  check(has(byPath, "S10 In Child"), "path:S10 Parent returns S10 In Child (subtree recursion)");

  const byStatus = await runView({ tag: null, path: null, props: [{ key: "status", value: "active" }] });
  check(has(byStatus, "S10 Active"), "prop status=active returns S10 Active");
  check(!has(byStatus, "S10 Draft"), "prop status=active EXCLUDES S10 Draft");
  check(!has(byStatus, "S10 Trash"), "prop status=active EXCLUDES soft-deleted S10 Trash");

  const byBoth = await runView({
    tag: null,
    path: null,
    props: [{ key: "status", value: "active" }, { key: "priority", value: "2" }],
  });
  check(has(byBoth, "S10 Active"), "status=active AND priority=2 returns S10 Active (AND-match)");

  const byExists = await runView({ tag: null, path: null, props: [{ key: "status", value: null }] });
  check(has(byExists, "S10 Active") && has(byExists, "S10 Draft"), "prop status (existence) returns Active + Draft");

  const activeRow = byStatus.find((r) => r.title === "S10 Active");
  check(activeRow?.properties.status === "active", "returned row carries properties.status");
  check(
    activeRow?.properties.priority === 2 && typeof activeRow?.properties.priority === "number",
    "priority is a TYPED number 2 (notes_for_view returns typed jsonb)",
  );

  const all = await runView({ tag: null, path: null, props: [] });
  check(has(all, "S10 Active") && has(all, "S10 Plain"), "empty filter = all live notes (incl. S10 Plain)");
  check(!has(all, "S10 Trash"), "empty filter EXCLUDES soft-deleted");

  // ── B. View CRUD ─────────────────────────────────────────────────────────────────────
  console.log("\n=== B. View CRUD: create / list / update (jsonb round-trip) / delete ===");
  const created = await createView({
    name: "S10 View",
    filter: { tag: null, path: null, props: [{ key: "status", value: "active" }] },
    columns: ["status"],
    sort: { key: "status", dir: "asc" },
    layout: "table",
  });
  check(created.ok, "createView ok");
  const viewId = created.ok ? created.view.id : "";
  check((await listViews()).some((v) => v.id === viewId), "listViews contains the new view");

  const updated = await updateView(viewId, { layout: "cards", columns: ["status", "priority"] });
  check(updated.ok && updated.view.layout === "cards", "updateView → layout cards");

  const reread = (await listViews()).find((v) => v.id === viewId);
  check(reread?.layout === "cards", "view persists layout=cards on re-list");
  check(eq(reread?.columns, ["status", "priority"]), "columns jsonb round-trips [status, priority]");
  check(
    eq(reread?.filter, { tag: null, path: null, props: [{ key: "status", value: "active" }] }),
    "filter jsonb round-trips intact",
  );

  check((await deleteView(viewId)).ok, "deleteView ok");
  check(!(await listViews()).some((v) => v.id === viewId), "view is gone after delete");

  // ── C. Inline-edit loop (the crux) ───────────────────────────────────────────────────
  console.log("\n=== C. Inline edit → pipeline re-derive → runView reflects (type-stable) ===");
  const e1 = await setNoteProperty(activeId, "status", "published");
  check(e1.ok, "setNoteProperty status=published ok");
  check(e1.ok && propsOf(e1.note).status === "published", "returned note.properties.status === published");

  const e2 = await setNoteProperty(activeId, "priority", 3);
  check(e2.ok, "setNoteProperty priority=3 ok");
  check(
    e2.ok && propsOf(e2.note).priority === 3 && typeof propsOf(e2.note).priority === "number",
    "priority stays a NUMBER 3 (no number→string flip through YAML)",
  );

  const afterActive = await runView({ tag: null, path: null, props: [{ key: "status", value: "active" }] });
  check(!has(afterActive, "S10 Active"), "after edit, status=active NO LONGER returns S10 Active");
  const afterPublished = await runView({ tag: null, path: null, props: [{ key: "status", value: "published" }] });
  check(has(afterPublished, "S10 Active"), "after edit, status=published NOW returns S10 Active (full loop)");

  const e3 = await setNoteProperty(brokenId, "status", "x");
  check(!e3.ok && e3.error === "invalid_yaml", "setNoteProperty on broken-YAML note refused (invalid_yaml)");

  // ── D. Pure units ────────────────────────────────────────────────────────────────────
  console.log("\n=== D. Pure units: coerceCellValue / sortViewRows / unionPropertyKeys ===");
  check(coerceCellValue(2, "3") === 3, "coerceCellValue(number 2, '3') → number 3");
  check(coerceCellValue("active", "draft") === "draft", "coerceCellValue(string, 'draft') → 'draft'");
  check(coerceCellValue(false, "true") === true, "coerceCellValue(bool, 'true') → true");
  check(eq(coerceCellValue(["a"], "a, b"), ["a", "b"]), "coerceCellValue(array, 'a, b') → ['a','b']");
  check(coerceCellValue(undefined, "5") === 5, "coerceCellValue(new key, '5') → number 5");
  check(coerceCellValue(undefined, "hello") === "hello", "coerceCellValue(new key, 'hello') → 'hello'");

  const mk = (title: string, props: Record<string, unknown>): ViewRow => ({
    id: title,
    title,
    folder_id: null,
    properties: props,
    created_at: "",
    updated_at: "",
  });
  const rows = [mk("B", { n: 10 }), mk("A", { n: 2 }), mk("C", {})]; // C missing the key
  check(
    eq(sortViewRows(rows, { key: "n", dir: "asc" }).map((r) => r.title), ["A", "B", "C"]),
    "sortViewRows numeric asc (2<10) + missing-key row last",
  );
  check(
    eq(sortViewRows(rows, { key: "n", dir: "desc" }).map((r) => r.title), ["B", "A", "C"]),
    "sortViewRows desc keeps missing-key row last (not flipped to top)",
  );

  const ukRows = [mk("x", { status: "a", _raw: "...", _raw_error: "e" }), mk("y", { priority: 1 })];
  check(eq(unionPropertyKeys(ukRows), ["priority", "status"]), "unionPropertyKeys excludes _raw/_raw_error, sorted");

  // ── Cleanup ──────────────────────────────────────────────────────────────────────────
  await db.from("views").delete().like("name", "S10 %");
  await db.from("notes").delete().like("title", "S10 %");
  await db.from("folders").delete().like("name", "S10 %");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
