"use client";

import { useState } from "react";
import type { OutgoingLinks } from "@/lib/links/outgoing";

/**
 * Outgoing links, in the right sidebar — companion to the backlinks panel.
 * Resolved (links to existing notes) and unresolved (links to not-yet-created notes) are
 * separated; embed links (`![[X]]`) get a muted "embed" pill. Clicking a resolved row opens
 * the note; clicking an unresolved row creates-then-opens it — the SAME `onNavigate` used by
 * preview wiki-links (app-shell's onWikiNavigate). Collapsible, matching the backlinks idiom.
 */
export function OutgoingLinksPanel({
  links,
  onNavigate,
}: {
  links: OutgoingLinks;
  onNavigate: (title: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const total = links.resolved.length + links.unresolved.length;
  return (
    <div className="border-t border-neutral-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
      >
        <span className="text-neutral-500">{open ? "▾" : "▸"}</span>
        Outgoing links ({total})
      </button>
      {open && (
        <div className="max-h-64 overflow-auto px-3 pb-3">
          {total === 0 ? (
            <p className="text-sm text-neutral-600">No outgoing links.</p>
          ) : (
            <>
              {links.resolved.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">Resolved</p>
                  {links.resolved.map((l) => (
                    <div key={l.targetId} className="flex items-center gap-1.5">
                      <button
                        onClick={() => onNavigate(l.title)}
                        className="truncate text-sm text-sky-400 hover:underline"
                      >
                        {l.title}
                      </button>
                      {l.isEmbed && <EmbedPill />}
                    </div>
                  ))}
                </div>
              )}
              {links.unresolved.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">Unresolved</p>
                  {links.unresolved.map((l) => (
                    <div key={l.title.toLowerCase()} className="flex items-center gap-1.5">
                      <button
                        onClick={() => onNavigate(l.title)}
                        className="truncate text-sm text-neutral-400 underline decoration-dashed hover:text-neutral-200"
                      >
                        {l.title}
                      </button>
                      {l.isEmbed && <EmbedPill />}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmbedPill() {
  return (
    <span className="shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">
      embed
    </span>
  );
}
