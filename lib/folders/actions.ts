"use server";

import { countRows, execute, query, queryOne } from "@/lib/db/server";

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

const FOLDER_COLS = "id, name, parent_id, created_at";

export async function listFolders(): Promise<FolderRow[]> {
  return query<FolderRow>(`select ${FOLDER_COLS} from folders order by name asc`);
}

export async function createFolder(input: { name: string; parentId?: string | null }): Promise<FolderRow> {
  const folder = await queryOne<FolderRow>(
    `insert into folders (name, parent_id) values ($1, $2) returning ${FOLDER_COLS}`,
    [input.name, input.parentId ?? null],
  );
  if (!folder) throw new Error("createFolder returned no row");
  return folder;
}

/** Find a TOP-LEVEL folder by case-insensitive name (oldest wins — names aren't unique). */
export async function findFolderByName(name: string): Promise<FolderRow | null> {
  return queryOne<FolderRow>(
    `select ${FOLDER_COLS}
     from folders
     where parent_id is null and lower(name) = lower($1)
     order by created_at asc
     limit 1`,
    [name],
  );
}

/** Find a top-level folder by name, creating it if absent. Used for the Daily folder. */
export async function getOrCreateFolderByName(name: string): Promise<FolderRow> {
  return (await findFolderByName(name)) ?? (await createFolder({ name }));
}

export async function renameFolder(id: string, name: string): Promise<FolderRow> {
  const folder = await queryOne<FolderRow>(
    `update folders set name = $2 where id = $1 returning ${FOLDER_COLS}`,
    [id, name],
  );
  if (!folder) throw new Error("Folder not found.");
  return folder;
}

/**
 * Refuse to delete a non-empty folder. The schema would otherwise hard-delete all
 * subfolders (parent_id cascade) and orphan notes to unfiled (folder_id set null) —
 * surprising and irreversible. Require the folder be emptied first (zero data loss).
 */
export async function deleteFolder(id: string): Promise<void> {
  const [childFolders, childNotes] = await Promise.all([
    countRows("select count(*) from folders where parent_id = $1", [id]),
    countRows("select count(*) from notes where folder_id = $1 and deleted_at is null", [id]),
  ]);
  if (childFolders > 0 || childNotes > 0) {
    throw new Error("Folder isn't empty — move or delete its contents first.");
  }
  await execute("delete from folders where id = $1", [id]);
}

/**
 * Move a note to a folder (or to unfiled when folderId is null). DIRECT metadata
 * update — deliberately NOT through the save pipeline: a move changes no title/body,
 * so it must not re-parse links/tags or cut a revision.
 */
export async function moveNote(noteId: string, folderId: string | null): Promise<void> {
  await execute("update notes set folder_id = $2 where id = $1 and deleted_at is null", [noteId, folderId]);
}
