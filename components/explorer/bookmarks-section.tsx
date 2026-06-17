"use client";

import { useState } from "react";
import type { Bookmark } from "@/lib/bookmarks/actions";
import { BOOKMARK_MIME } from "../types";

const GLYPH: Record<Bookmark["kind"], string> = { note: "📄", search: "🔍", heading: "#" };

/**
 * Bookmarks section atop the left sidebar. Lists starred notes / searches /
 * headings; clicking opens (app-shell dispatches by kind); ✕ removes. Rows reorder by drag — a
 * list-internal HTML5 DnD using a distinct BOOKMARK_MIME so a bookmark drag can't be confused
 * with the explorer's note→folder drag (NOTE_MIME). Reorder is optimistic; the parent persists
 * sort_order and refetches on failure. Collapsible.
 */
export function BookmarksSection({
  bookmarks,
  onOpen,
  onReorder,
  onRemove,
}: {
  bookmarks: Bookmark[];
  onOpen: (b: Bookmark) => void;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; below: boolean } | null>(null);

  function handleDrop(targetId: string, below: boolean) {
    const dragging = dragId;
    setDragId(null);
    setOver(null);
    if (!dragging || dragging === targetId) return;
    const ids = bookmarks.map((b) => b.id);
    const from = ids.indexOf(dragging);
    if (from === -1) return;
    ids.splice(from, 1);
    let to = ids.indexOf(targetId);
    if (to === -1) to = ids.length;
    else if (below) to += 1;
    ids.splice(to, 0, dragging);
    onReorder(ids);
  }

  return (
    <div className="shrink-0 border-b border-neutral-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
      >
        <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        Bookmarks ({bookmarks.length})
      </button>
      {open && (
        <div className="max-h-48 overflow-auto pb-1">
          {bookmarks.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-neutral-600">Star a note, search, or heading.</p>
          ) : (
            bookmarks.map((b) => {
              const isOver = over?.id === b.id && dragId !== b.id;
              return (
                <div
                  key={b.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(BOOKMARK_MIME, b.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(b.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return; // ignore foreign drags (e.g. a note being dragged)
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const r = e.currentTarget.getBoundingClientRect();
                    setOver({ id: b.id, below: e.clientY > r.top + r.height / 2 });
                  }}
                  onDrop={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    handleDrop(b.id, e.clientY > r.top + r.height / 2);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  className={`group flex items-center gap-1.5 px-3 py-1 ${
                    isOver ? (over?.below ? "border-b-2 border-sky-500" : "border-t-2 border-sky-500") : ""
                  } ${dragId === b.id ? "opacity-40" : ""}`}
                >
                  <span className="w-3 shrink-0 text-center text-xs text-neutral-500" aria-hidden="true">
                    {GLYPH[b.kind]}
                  </span>
                  <button
                    onClick={() => onOpen(b)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-neutral-300 hover:text-sky-400"
                    title={b.label ?? b.kind}
                  >
                    {b.label ?? "(untitled)"}
                  </button>
                  <button
                    onClick={() => onRemove(b.id)}
                    title="Remove bookmark"
                    aria-label="Remove bookmark"
                    className="shrink-0 px-1 text-xs text-neutral-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
