"use client";

import { useState } from "react";
import type { Heading } from "@/lib/outline/headings";

/**
 * Outline, in the right sidebar — the heading tree of the current note, indented
 * by level. Clicking a heading scrolls the active pane to it (app-shell's `onScrollToHeading`
 * switches on mode: preview → scrollIntoView by id; edit → CodeMirror scrolls to the line). The
 * ★ stars/unstars a heading bookmark; filled when already bookmarked for this note.
 * Collapsible, matching the backlinks/outgoing idiom.
 */
export function OutlinePanel({
  headings,
  bookmarkedSlugs,
  onScrollToHeading,
  onToggleHeadingBookmark,
}: {
  headings: Heading[];
  bookmarkedSlugs: Set<string>;
  onScrollToHeading: (h: Heading) => void;
  onToggleHeadingBookmark: (h: Heading) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
      >
        <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        Outline ({headings.length})
      </button>
      {open && (
        <div className="max-h-64 overflow-auto px-2 pb-3">
          {headings.length === 0 ? (
            <p className="px-1 text-sm text-neutral-600">No headings.</p>
          ) : (
            headings.map((h) => {
              const starred = bookmarkedSlugs.has(h.slug);
              return (
                <div key={`${h.line}:${h.slug}`} className="group flex items-center gap-1">
                  <button
                    onClick={() => onScrollToHeading(h)}
                    className="min-w-0 flex-1 truncate py-0.5 text-left text-sm text-neutral-300 hover:text-sky-400"
                    style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                  <button
                    onClick={() => onToggleHeadingBookmark(h)}
                    title={starred ? "Remove bookmark" : "Bookmark heading"}
                    aria-label={starred ? "Remove heading bookmark" : "Bookmark heading"}
                    className={`shrink-0 px-1 text-sm ${
                      starred
                        ? "text-amber-400"
                        : "text-neutral-700 opacity-0 hover:text-amber-400 group-hover:opacity-100"
                    }`}
                  >
                    {starred ? "★" : "☆"}
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
