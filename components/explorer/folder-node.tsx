"use client";

import { useState } from "react";
import { NoteRow } from "./note-row";
import type { FolderItem, TreeCtx } from "../types";
import { NOTE_MIME } from "../types";

export function FolderNode({ folder, depth, ctx }: { folder: FolderItem; depth: number; ctx: TreeCtx }) {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const subFolders = ctx.childFolders.get(folder.id) ?? [];
  const notes = ctx.notesByFolder.get(folder.id) ?? [];

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded py-0.5 pr-1 hover:bg-neutral-800 ${
          dragOver ? "bg-sky-900/40 ring-1 ring-sky-600" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onDragOver={(e) => {
          // preventDefault on dragover is REQUIRED or drop never fires. stopPropagation so
          // only the deepest folder under the cursor is the drop target.
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const noteId = e.dataTransfer.getData(NOTE_MIME);
          if (noteId) ctx.onMoveNote(noteId, folder.id);
        }}
      >
        <button onClick={() => setExpanded((v) => !v)} className="w-4 shrink-0 text-neutral-500">
          {expanded ? "▾" : "▸"}
        </button>
        <span
          className="min-w-0 flex-1 cursor-default select-none truncate"
          onDoubleClick={() => ctx.onRenameFolder(folder.id, folder.name)}
          title={folder.name}
        >
          📁 {folder.name}
        </span>
        <span className="hidden shrink-0 gap-1 text-neutral-400 group-hover:flex">
          <button title="New note here" onClick={() => ctx.onNewNote(folder.id)} className="px-1 hover:text-neutral-100">＋</button>
          <button title="Rename folder" onClick={() => ctx.onRenameFolder(folder.id, folder.name)} className="px-1 hover:text-neutral-100">✎</button>
          <button title="Delete folder" onClick={() => ctx.onDeleteFolder(folder.id)} className="px-1 hover:text-red-400">🗑</button>
        </span>
      </div>

      {expanded && (
        <div>
          {subFolders.map((sf) => (
            <FolderNode key={sf.id} folder={sf} depth={depth + 1} ctx={ctx} />
          ))}
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} depth={depth + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
