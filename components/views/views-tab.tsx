"use client";

import type { View } from "@/lib/views/types";

/** Glyph hints the layout at a glance: rows for a table, a grid for cards. */
const LAYOUT_GLYPH: Record<string, string> = { table: "≡", cards: "▦" };

/**
 * The Views tab in the left sidebar: the list of saved views with a ＋ New view
 * affordance and per-row delete. Clicking a view opens it in the center pane. No reorder in V1
 * (the list is in creation order).
 */
export function ViewsTab({
  views,
  openViewId,
  onOpenView,
  onNewView,
  onDeleteView,
}: {
  views: View[];
  openViewId: string | null;
  onOpenView: (id: string) => void;
  onNewView: () => void;
  onDeleteView: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-neutral-800 p-2">
        <button
          onClick={onNewView}
          className="w-full rounded px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ＋ New view
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {views.length === 0 ? (
          <div className="p-3 text-xs text-neutral-600">No views yet. Create one with ＋ New view.</div>
        ) : (
          views.map((v) => {
            const active = v.id === openViewId;
            return (
              <div
                key={v.id}
                className={`group flex items-center gap-2 rounded px-2 py-1 text-sm ${
                  active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
                }`}
              >
                <button
                  onClick={() => onOpenView(v.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={v.name}
                >
                  <span className="w-4 shrink-0 text-center text-neutral-500">
                    {LAYOUT_GLYPH[v.layout] ?? "≡"}
                  </span>
                  <span className="truncate">{v.name}</span>
                </button>
                <button
                  onClick={() => onDeleteView(v.id)}
                  title={`Delete ${v.name}`}
                  aria-label={`Delete view ${v.name}`}
                  className="shrink-0 text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
