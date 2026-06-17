/**
 * Exit test — daily notes + templates.
 *
 * Proves the load-bearing claims at the data layer (the UI half — app-opens-to-today,
 * Cmd+D, ‹/› chevrons, the picker — is verified in-app with screenshots):
 *   A. substitution-before-parse  — properties/links/tags reflect SUBSTITUTED values
 *   B. idempotency                — 2 get-or-create calls → 1 row, same id
 *   C. flag survives autosave     — an edit through the pipeline leaves is_daily/daily_date
 *   D. prev/next dates            — addDays local math + distinct dated daily notes
 *   E. B1 collision               — a non-daily note titled like the date is NOT mutated
 *   F. templates                  — listTemplates + create-from-template (unfiled, parsed)
 *
 * Run: npx tsx scripts/exit-test-s5.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getOrCreateFolderByName } from "../lib/folders/actions";
import { createNote, updateNote } from "../lib/notes/actions";
import { getOrCreateDailyNote } from "../lib/daily/actions";
import { listTemplates, createNoteFromTemplate } from "../lib/templates/actions";
import { addDays } from "../lib/daily/dates";

const TITLES = [
  "2026-06-13",
  "2026-06-12",
  "2026-06-14",
  "2026-06-15",
  "Daily",
  "__tpl_meeting",
  "Standup 2026-06-13",
];

const DAILY_TEMPLATE = [
  '---',
  'date: "{{date}}"',
  '---',
  "# {{title}}",
  "",
  "Logged at {{time}}. See [[{{title}}]].",
  "",
  "#daily",
].join("\n");

const MEETING_TEMPLATE = [
  "# {{title}}",
  "Date: {{date}} {{time}}",
  "Attendees: [[{{title}} attendees]]",
  "",
  "#meeting",
].join("\n");

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env (SUPABASE_SERVICE_ROLE_KEY in .env.local).");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.from("notes").delete().in("title", TITLES); // repeatable (folders reused idempotently)

  // Seed templates in the Templates folder.
  const templatesFolder = await getOrCreateFolderByName("Templates");
  const tplDaily = await createNote({ title: "Daily", body: DAILY_TEMPLATE, folderId: templatesFolder.id });
  const tplMeeting = await createNote({ title: "__tpl_meeting", body: MEETING_TEMPLATE, folderId: templatesFolder.id });
  if (!tplDaily.ok || !tplMeeting.ok) throw new Error("template seed failed");
  const meetingId = tplMeeting.note.id as string;

  // ── A. Substitution-before-parse ─────────────────────────────────────────────
  console.log("\n=== A. Daily from template: substitution happens BEFORE the pipeline parses ===");
  const r1 = await getOrCreateDailyNote({ date: "2026-06-13", time: "14:30" });
  if (!r1.ok) throw new Error(`expected ok, got ${JSON.stringify(r1)}`);
  const dailyId = r1.note.id as string;
  const { data: dn } = await db.from("notes").select("*").eq("id", dailyId).single();
  check(dn.is_daily === true, "is_daily = true");
  check(dn.daily_date === "2026-06-13", `daily_date = 2026-06-13 (got ${dn.daily_date})`);
  check(dn.title === "2026-06-13", "title = the date string");
  check(dn.folder_id != null && dn.folder_id !== templatesFolder.id, "filed in a folder (not Templates)");
  const { data: dailyFolder } = await db.from("folders").select("name").eq("id", dn.folder_id).single();
  check(dailyFolder?.name === "Daily", `folder is "Daily" (got ${dailyFolder?.name})`);
  check(dn.properties?.date === "2026-06-13", `properties.date = "2026-06-13" — frontmatter parsed the SUBSTITUTED value (got ${JSON.stringify(dn.properties)})`);

  const { data: dLinks } = await db.from("links").select("*").eq("source_id", dailyId);
  const selfLink = (dLinks ?? []).find((l) => l.target_title.toLowerCase() === "2026-06-13");
  check(!!selfLink, "[[{{title}}]] → [[2026-06-13]] link row exists (parsed from substituted body)");
  check(selfLink?.target_id === dailyId, "…and it resolved to the daily note itself (self-link)");
  check(!(dLinks ?? []).some((l) => l.target_title.includes("{{")), "NEGATIVE: no literal {{title}} link (would mean parse-before-substitute)");

  const { data: nt } = await db.from("note_tags").select("tag_id").eq("note_id", dailyId);
  const { data: tagRows } = await db.from("tags").select("name").in("id", (nt ?? []).map((r) => r.tag_id));
  const tagNames = (tagRows ?? []).map((r) => r.name);
  check(tagNames.includes("daily"), "#daily tag parsed from substituted body");
  check(!tagNames.some((n) => n.includes("{")), "NEGATIVE: no braced tag");

  // ── B. Idempotency ───────────────────────────────────────────────────────────
  console.log("\n=== B. Idempotency: 2nd get-or-create returns the SAME note, no duplicate row ===");
  const r2 = await getOrCreateDailyNote({ date: "2026-06-13", time: "14:31" });
  check(r2.ok && (r2.note.id as string) === dailyId, "same id on second call");
  const { count: dailyCount } = await db
    .from("notes").select("*", { count: "exact", head: true })
    .eq("is_daily", true).eq("daily_date", "2026-06-13").is("deleted_at", null);
  check(dailyCount === 1, `exactly 1 daily row for 2026-06-13 (got ${dailyCount})`);

  // ── C. Flag survives an autosave edit ─────────────────────────────────────────
  console.log("\n=== C. is_daily/daily_date survive an edit through the save pipeline ===");
  const { count: revsBefore } = await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", dailyId);
  const upd = await updateNote({ id: dailyId, title: "2026-06-13", body: "edited daily body — no frontmatter" });
  check(upd.ok, "updateNote succeeded");
  const { data: dn2 } = await db.from("notes").select("is_daily, daily_date").eq("id", dailyId).single();
  check(dn2?.is_daily === true, "is_daily STILL true after edit");
  check(dn2?.daily_date === "2026-06-13", "daily_date STILL 2026-06-13 after edit");
  const { count: revsAfter } = await db.from("note_revisions").select("*", { count: "exact", head: true }).eq("note_id", dailyId);
  check(revsBefore === 1 && revsAfter === 1, `revision debounce held (before=${revsBefore}, after=${revsAfter}, expected 1/1)`);

  // ── D. Prev/next ───────────────────────────────────────────────────────────────
  console.log("\n=== D. Prev/next day math (local TZ) + distinct dated daily notes ===");
  check(addDays("2026-06-13", -1) === "2026-06-12", "addDays(-1)");
  check(addDays("2026-06-13", 1) === "2026-06-14", "addDays(+1)");
  check(addDays("2026-01-01", -1) === "2025-12-31", "addDays rolls year/month backward");
  check(addDays("2026-02-28", 1) === "2026-03-01", "addDays handles non-leap Feb (UTC-parse trap)");
  const prev = await getOrCreateDailyNote({ date: "2026-06-12", time: "08:00" });
  const next = await getOrCreateDailyNote({ date: "2026-06-14", time: "08:00" });
  check(
    prev.ok && next.ok &&
      new Set([dailyId, prev.note.id as string, next.note.id as string]).size === 3,
    "three distinct daily notes (12th/13th/14th)",
  );
  check(prev.ok && (prev.note.daily_date as string) === "2026-06-12" && (prev.note.is_daily as boolean), "prev note correctly dated + daily");
  check(next.ok && (next.note.daily_date as string) === "2026-06-14" && (next.note.is_daily as boolean), "next note correctly dated + daily");

  // ── E. B1 collision ──────────────────────────────────────────────────────────
  console.log("\n=== E. B1: a NON-daily note titled like the date must NOT be hijacked ===");
  const manual = await createNote({ title: "2026-06-15", body: "hand-written, not a daily" });
  if (!manual.ok) throw new Error("manual create failed");
  const manualId = manual.note.id as string;
  const collide = await getOrCreateDailyNote({ date: "2026-06-15", time: "10:00" });
  check(!collide.ok && collide.error === "title_taken_by_nondaily", "returns title_taken_by_nondaily");
  check(!collide.ok && (collide.note.id as string) === manualId, "…carrying the colliding note so the UI can open it");
  const { data: mn } = await db.from("notes").select("is_daily").eq("id", manualId).single();
  check(mn?.is_daily === false, "the manual note was NOT converted to a daily");
  const { count: spurious } = await db.from("notes").select("*", { count: "exact", head: true }).eq("is_daily", true).eq("daily_date", "2026-06-15");
  check(spurious === 0, `no daily row created for 2026-06-15 (got ${spurious})`);

  // ── F. Templates ───────────────────────────────────────────────────────────────
  console.log("\n=== F. Templates: list + create-from-template (unfiled, vars substituted + parsed) ===");
  const tpls = await listTemplates();
  const tplTitles = tpls.map((t) => t.title);
  check(tplTitles.includes("Daily") && tplTitles.includes("__tpl_meeting"), `listTemplates returns the templates (got ${JSON.stringify(tplTitles)})`);

  const inst = await createNoteFromTemplate({ templateId: meetingId, title: "Standup 2026-06-13", date: "2026-06-13", time: "09:00" });
  check(inst.ok, "create-from-template succeeded");
  if (inst.ok) {
    const instId = inst.note.id as string;
    const { data: insNote } = await db.from("notes").select("*").eq("id", instId).single();
    check(insNote.folder_id === null, "instance is UNFILED (folder_id null)");
    check(insNote.is_daily === false, "instance is not a daily note");
    check(insNote.body.includes("2026-06-13") && insNote.body.includes("09:00") && insNote.body.includes("Standup 2026-06-13"), "body has substituted {{date}}/{{time}}/{{title}}");
    check(!insNote.body.includes("{{"), "NEGATIVE: no leftover {{...}} tokens");
    const { data: iNt } = await db.from("note_tags").select("tag_id").eq("note_id", instId);
    const { data: iTags } = await db.from("tags").select("name").in("id", (iNt ?? []).map((r) => r.tag_id));
    check((iTags ?? []).some((t) => t.name === "meeting"), "#meeting tag parsed from the instance");
    const { data: iLinks } = await db.from("links").select("target_title").eq("source_id", instId);
    check((iLinks ?? []).some((l) => l.target_title === "Standup 2026-06-13 attendees"), "[[{{title}} attendees]] link parsed from substituted body");
  }

  const dup = await createNoteFromTemplate({ templateId: meetingId, title: "Standup 2026-06-13", date: "2026-06-13", time: "09:00" });
  check(!dup.ok && dup.error === "duplicate_title", "duplicate title → duplicate_title (the inline-error path)");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
