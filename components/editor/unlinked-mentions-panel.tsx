"use client";

import { useState } from "react";
import type { UnlinkedMention } from "@/lib/links/mentions";

/**
 * Unlinked mentions, stacked directly below the backlinks panel. Each entry is a
 * source note that mentions this note's title as plain text (without a link), with its context
 * line(s) and a one-click "Link" button that rewrites every plain occurrence in that source to
 * `[[Title]]` (server-side, through the save pipeline). Collapsible — mirrors the backlinks idiom.
 */
export function UnlinkedMentionsPanel({
  mentions,
  onOpenNote,
  onLink,
}: {
  mentions: UnlinkedMention[];
  onOpenNote: (id: string) => void;
  onLink: (sourceId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
      >
        <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        Unlinked mentions ({mentions.length})
      </button>
      {open && (
        <div className="max-h-48 overflow-auto px-4 pb-3">
          {mentions.length === 0 ? (
            <p className="text-sm text-neutral-600">No unlinked mentions.</p>
          ) : (
            mentions.map((m) => (
              <div key={m.sourceId} className="mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenNote(m.sourceId)}
                    className="min-w-0 truncate text-sm text-sky-400 hover:underline"
                  >
                    {m.sourceTitle}
                  </button>
                  <button
                    onClick={() => onLink(m.sourceId)}
                    title="Rewrite the plain text to a [[link]]"
                    className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300 hover:bg-neutral-800 hover:text-sky-300"
                  >
                    Link
                  </button>
                </div>
                {m.snippets.map((s, i) => (
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
