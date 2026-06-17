// Shared client-side types for the app shell + explorer.

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface NoteItem {
  id: string;
  title: string;
  folder_id: string | null;
}

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** Context threaded through the recursive folder tree. */
export interface TreeCtx {
  childFolders: Map<string | null, FolderItem[]>;
  notesByFolder: Map<string | null, NoteItem[]>;
  openNoteId: string | null;
  onOpenNote: (id: string) => void;
  onNewNote: (folderId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onRenameFolder: (id: string, current: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
}

/** Custom drag MIME so note drags don't collide with text/url drags. */
export const NOTE_MIME = "application/x-tourmaline-note";

/** Distinct MIME for intra-list bookmark reordering (3.4) — can't be confused with NOTE_MIME. */
export const BOOKMARK_MIME = "application/x-tourmaline-bookmark";
