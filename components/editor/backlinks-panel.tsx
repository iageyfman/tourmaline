"use client";

import { useState } from "react";
import type { Backlink } from "@/lib/links/snippets";

/**
 * Backlinks at the bottom of the note view. Each entry is a clickable source
 * note + its context snippet line(s). Collapsible.
 */
export function BacklinksPanel({
  backlinks,
  onOpenNote,
}: {
  backlinks: Backlink[];
  onOpenNote: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
      >
        <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        Backlinks ({backlinks.length})
      </button>
      {open && (
        <div className="max-h-48 overflow-auto px-4 pb-3">
          {backlinks.length === 0 ? (
            <p className="text-sm text-neutral-600">No backlinks.</p>
          ) : (
            backlinks.map((b) => (
              <div key={b.sourceId} className="mb-2">
                <button
                  onClick={() => onOpenNote(b.sourceId)}
                  className="text-sm text-sky-400 hover:underline"
                >
                  {b.sourceTitle}
                </button>
                {b.snippets.map((s, i) => (
                  <p key={i} className="truncate pl-3 text-xs text-neutral-500">
                    {s}
                  </p>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
