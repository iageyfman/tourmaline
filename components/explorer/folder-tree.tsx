"use client";

import { useMemo, useState } from "react";
import { FolderNode } from "./folder-node";
import { NoteRow } from "./note-row";
import type { FolderItem, NoteItem, TreeCtx } from "../types";
import { NOTE_MIME } from "../types";

export interface ExplorerProps {
  folders: FolderItem[];
  notes: NoteItem[];
  openNoteId: string | null;
  onOpenNote: (id: string) => void;
  onNewNote: (folderId: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onRenameFolder: (id: string, current: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onNewFromTemplate: () => void;
}

export function FolderTree(props: ExplorerProps) {
  const [rootDragOver, setRootDragOver] = useState(false);

  const ctx: TreeCtx = useMemo(() => {
    const childFolders = new Map<string | null, FolderItem[]>();
    for (const f of props.folders) {
      const arr = childFolders.get(f.parent_id);
      if (arr) arr.push(f);
      else childFolders.set(f.parent_id, [f]);
    }
    const notesByFolder = new Map<string | null, NoteItem[]>();
    for (const n of props.notes) {
      const arr = notesByFolder.get(n.folder_id);
      if (arr) arr.push(n);
      else notesByFolder.set(n.folder_id, [n]);
    }
    return {
      childFolders,
      notesByFolder,
      openNoteId: props.openNoteId,
      onOpenNote: props.onOpenNote,
      onNewNote: props.onNewNote,
      onNewFolder: props.onNewFolder,
      onRenameFolder: props.onRenameFolder,
      onDeleteFolder: props.onDeleteFolder,
      onDeleteNote: props.onDeleteNote,
      onMoveNote: props.onMoveNote,
    };
  }, [props]);

  const rootFolders = ctx.childFolders.get(null) ?? [];
  const unfiled = ctx.notesByFolder.get(null) ?? [];

  return (
    <div className="flex h-full flex-col p-2 text-sm">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Explorer</span>
        <span className="flex gap-2 text-neutral-400">
          <button title="New note" onClick={() => props.onNewNote(null)} className="rounded px-1 hover:bg-neutral-800">＋ note</button>
          <button title="New folder" onClick={() => props.onNewFolder(null)} className="rounded px-1 hover:bg-neutral-800">＋ folder</button>
          <button title="New from template" onClick={() => props.onNewFromTemplate()} className="rounded px-1 hover:bg-neutral-800">＋ template</button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rootFolders.map((f) => (
          <FolderNode key={f.id} folder={f} depth={0} ctx={ctx} />
        ))}

        {/* Unfiled root bucket — also the drop target for un-filing a note */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setRootDragOver(true);
          }}
          onDragLeave={() => setRootDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootDragOver(false);
            const id = e.dataTransfer.getData(NOTE_MIME);
            if (id) props.onMoveNote(id, null);
          }}
          className={`mt-3 rounded pb-4 ${rootDragOver ? "ring-1 ring-sky-600" : ""}`}
        >
          <div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">Unfiled</div>
          {unfiled.length === 0 ? (
            <div className="px-2 py-1 text-xs text-neutral-700">— drop here to unfile —</div>
          ) : (
            unfiled.map((n) => <NoteRow key={n.id} note={n} depth={0} ctx={ctx} />)
          )}
        </div>
      </div>
    </div>
  );
}
