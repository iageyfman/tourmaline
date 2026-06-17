"use server";

import { query, queryOne } from "@/lib/db/server";
import { parseNote } from "@/lib/pipeline/parse";
import { substituteVars } from "@/lib/templates/substitute";
import { getDailyTemplateBody } from "@/lib/templates/actions";
import { getOrCreateFolderByName, type FolderRow } from "@/lib/folders/actions";

// Discriminated result (like the notes SaveResult): the collision case carries the note so
// the UI can still open it. `folder` is non-null only when a brand-new note was created in a
// (possibly brand-new) Daily folder, so the client can merge that folder into its tree.
export type DailyResult =
  | { ok: true; note: Record<string, unknown>; folder: FolderRow | null }
  | { ok: false; error: "title_taken_by_nondaily"; message: string; note: Record<string, unknown> };

/**
 * Get or create the daily note for `date` (a client-computed local YYYY-MM-DD — never
 * derive "today" on the server, which is UTC). Opening an existing daily is a single SELECT.
 * Creation applies the "Daily" template (substituted), parses it (pipeline), and hands the
 * result to the atomic get_or_create_daily_note RPC so the is_daily flag is set in the same
 * statement as the insert (no half-built window) and concurrent calls converge to one row.
 */
export async function getOrCreateDailyNote(input: { date: string; time: string }): Promise<DailyResult> {
  const { date, time } = input;

  // 1. Fast path: today's daily already exists — return it untouched (no folder/template work).
  const existing = await query<Record<string, unknown>>(
    `select *
     from notes
     where is_daily = true and daily_date = $1 and deleted_at is null
     order by created_at asc
     limit 1`,
    [date],
  );
  if (existing.length > 0) {
    return { ok: true, note: existing[0], folder: null };
  }

  // 2. Create: ensure the Daily folder, apply the daily template, parse, then the atomic RPC.
  const folder = await getOrCreateFolderByName("Daily");
  const substituted = substituteVars(await getDailyTemplateBody(), { date, time, title: date });
  const parsed = parseNote({ title: date, body: substituted });

  const links = parsed.links.map((l) => ({
    target_title: l.targetTitle,
    is_embed: l.isEmbed,
    position: l.position,
  }));
  const row = await queryOne<{ result: { created: boolean; collision: boolean; note: Record<string, unknown> } }>(
    "select get_or_create_daily_note($1::date, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7::text[]) as result",
    [date, date, parsed.body, folder.id, JSON.stringify(parsed.properties), JSON.stringify(links), parsed.tags],
  );
  if (!row) throw new Error("get_or_create_daily_note returned no row");

  const result = row.result;
  if (result.collision) {
    // A NON-daily note already owns this date as its title; never mutate it.
    return {
      ok: false,
      error: "title_taken_by_nondaily",
      message: `A note titled "${date}" already exists — can't make it today's daily note.`,
      note: result.note,
    };
  }
  // folder matters to the client only when we actually created the note (it may be brand-new).
  return { ok: true, note: result.note, folder: result.created ? folder : null };
}
