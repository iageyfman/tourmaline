"use server";

import { query, queryOne } from "@/lib/db/server";
import { createNote } from "@/lib/notes/actions";
import { findFolderByName } from "@/lib/folders/actions";
import { substituteVars } from "./substitute";

// A template is just a note in the top-level "Templates" folder (SPEC 2.2). The daily-note
// template (SPEC 2.1) is the one titled "Daily" inside it. Both are looked up by name;
// neither reader creates the Templates folder (it's made lazily on first authoring).
const TEMPLATES_FOLDER = "Templates";
const DAILY_TEMPLATE_TITLE = "Daily";

/** Notes in the Templates folder, as picker rows. Empty if there's no Templates folder. */
export async function listTemplates(): Promise<{ id: string; title: string }[]> {
  const folder = await findFolderByName(TEMPLATES_FOLDER);
  if (!folder) return [];
  return query<{ id: string; title: string }>(
    "select id, title from notes where folder_id = $1 and deleted_at is null order by title asc",
    [folder.id],
  );
}

/** Body of the daily-note template (the note titled "Daily" in Templates), or "" if none. */
export async function getDailyTemplateBody(): Promise<string> {
  const folder = await findFolderByName(TEMPLATES_FOLDER);
  if (!folder) return "";
  const row = await queryOne<{ body: string }>(
    `select body
     from notes
     where folder_id = $1 and lower(title) = lower($2) and deleted_at is null
     order by created_at asc
     limit 1`,
    [folder.id, DAILY_TEMPLATE_TITLE],
  );
  return row?.body ?? "";
}

/**
 * Instantiate a template into a new UNFILED note: fetch the template body, substitute the
 * {{date}}/{{time}}/{{title}} vars, then run the normal create pipeline via createNote
 * (auto-"Untitled" on blank title; 23505 -> duplicate_title). Substitution happens BEFORE
 * createNote parses, so links/tags/frontmatter in the result are parsed as real content.
 * Returns createNote's SaveResult union.
 */
export async function createNoteFromTemplate(input: {
  templateId: string;
  title: string;
  date: string;
  time: string;
}) {
  const row = await queryOne<{ body: string }>(
    "select body from notes where id = $1 and deleted_at is null",
    [input.templateId],
  );
  if (!row) throw new Error("Template not found.");
  const body = substituteVars(row.body ?? "", {
    date: input.date,
    time: input.time,
    title: input.title,
  });
  return createNote({ title: input.title, body, folderId: null });
}
