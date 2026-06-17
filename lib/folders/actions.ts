"use server";

import { createServerClient } from "@/lib/supabase/server";

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

const FOLDER_COLS = "id, name, parent_id, created_at";

export async function listFolders(): Promise<FolderRow[]> {
  const { data, error } = await createServerClient()
    .from("folders")
    .select(FOLDER_COLS)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FolderRow[];
}

export async function createFolder(input: { name: string; parentId?: string | null }): Promise<FolderRow> {
  const { data, error } = await createServerClient()
    .from("folders")
    .insert({ name: input.name, parent_id: input.parentId ?? null })
    .select(FOLDER_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as FolderRow;
}

/** Find a TOP-LEVEL folder by case-insensitive name (oldest wins — names aren't unique). */
export async function findFolderByName(name: string): Promise<FolderRow | null> {
  const { data, error } = await createServerClient()
    .from("folders")
    .select(FOLDER_COLS)
    .is("parent_id", null)
    .ilike("name", name) // no wildcards in name -> case-insensitive exact match
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? (data[0] as FolderRow) : null;
}

/** Find a top-level folder by name, creating it if absent. Used for the Daily folder. */
export async function getOrCreateFolderByName(name: string): Promise<FolderRow> {
  return (await findFolderByName(name)) ?? (await createFolder({ name }));
}

export async function renameFolder(id: string, name: string): Promise<FolderRow> {
  const { data, error } = await createServerClient()
    .from("folders")
    .update({ name })
    .eq("id", id)
    .select(FOLDER_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as FolderRow;
}

/**
 * Refuse to delete a non-empty folder. The schema would otherwise hard-delete all
 * subfolders (parent_id cascade) and orphan notes to unfiled (folder_id set null) —
 * surprising and irreversible. Require the folder be emptied first (zero data loss).
 */
export async function deleteFolder(id: string): Promise<void> {
  const db = createServerClient();
  const [childFolders, childNotes] = await Promise.all([
    db.from("folders").select("*", { count: "exact", head: true }).eq("parent_id", id),
    db.from("notes").select("*", { count: "exact", head: true }).eq("folder_id", id).is("deleted_at", null),
  ]);
  if (childFolders.error) throw new Error(childFolders.error.message);
  if (childNotes.error) throw new Error(childNotes.error.message);
  if ((childFolders.count ?? 0) > 0 || (childNotes.count ?? 0) > 0) {
    throw new Error("Folder isn't empty — move or delete its contents first.");
  }
  const { error } = await db.from("folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Move a note to a folder (or to unfiled when folderId is null). DIRECT metadata
 * update — deliberately NOT through the save pipeline: a move changes no title/body,
 * so it must not re-parse links/tags or cut a revision.
 */
export async function moveNote(noteId: string, folderId: string | null): Promise<void> {
  const { error } = await createServerClient()
    .from("notes")
    .update({ folder_id: folderId })
    .eq("id", noteId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}
