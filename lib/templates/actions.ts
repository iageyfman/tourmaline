"use server";

import { createServerClient } from "@/lib/supabase/server";
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
  const { data, error } = await createServerClient()
    .from("notes")
    .select("id, title")
    .eq("folder_id", folder.id)
    .is("deleted_at", null)
    .order("title", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string }[];
}

/** Body of the daily-note template (the note titled "Daily" in Templates), or "" if none. */
export async function getDailyTemplateBody(): Promise<string> {
  const folder = await findFolderByName(TEMPLATES_FOLDER);
  if (!folder) return "";
  const { data, error } = await createServerClient()
    .from("notes")
    .select("body")
    .eq("folder_id", folder.id)
    .ilike("title", DAILY_TEMPLATE_TITLE)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? ((data[0].body as string) ?? "") : "";
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
  const { data, error } = await createServerClient()
    .from("notes")
    .select("body")
    .eq("id", input.templateId)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  const body = substituteVars((data?.body as string) ?? "", {
    date: input.date,
    time: input.time,
    title: input.title,
  });
  return createNote({ title: input.title, body, folderId: null });
}
