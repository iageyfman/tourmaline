"use client";

import type { NoteItem, TreeCtx } from "../types";
import { NOTE_MIME } from "../types";

export function NoteRow({ note, depth, ctx }: { note: NoteItem; depth: number; ctx: TreeCtx }) {
  const active = ctx.openNoteId === note.id;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_MIME, note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex items-center gap-1 rounded py-0.5 pr-1 hover:bg-neutral-800 ${
        active ? "bg-neutral-800 text-sky-300" : ""
      }`}
      style={{ paddingLeft: depth * 12 + 20 }}
    >
      <button
        className="min-w-0 flex-1 truncate text-left"
        onClick={() => ctx.onOpenNote(note.id)}
        title={note.title}
      >
        📄 {note.title}
      </button>
      <button
        title="Delete note"
        onClick={() => ctx.onDeleteNote(note.id)}
        className="hidden shrink-0 px-1 text-neutral-500 hover:text-red-400 group-hover:block"
      >
        🗑
      </button>
    </div>
  );
}
