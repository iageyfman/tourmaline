"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { graphData, type GraphData } from "@/lib/graph/actions";
import { buildFolderColors } from "@/lib/graph/colors";
import { GraphCanvas } from "./graph/graph-canvas";
import type { FolderItem } from "./types";

/**
 * Graph overlay (features 3.1 full graph + 3.2 local graph). ONE component, two scoped queries: a
 * Global|Local toggle swaps the RPC args (full vault vs the open note's ego network within 1–2
 * hops). Mirrors the search/switcher modal shell. A per-(mode,center,depth) result cache means
 * toggling back doesn't refetch or reheat the layout; tag/folder filtering is client-side.
 */
export function GraphModal({
  centerNoteId,
  folders,
  onOpenNote,
  onClose,
}: {
  centerNoteId: string | null;
  folders: FolderItem[];
  onOpenNote: (id: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"global" | "local">("global");
  const [depth, setDepth] = useState<1 | 2>(2);
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const seqRef = useRef(0); // bumped per fetch; only the latest result is adopted
  const cacheRef = useRef<Map<string, GraphData>>(new Map());

  const localAvailable = centerNoteId != null;
  const folderColors = useMemo(() => buildFolderColors(folders), [folders]);

  // Focus the box, Esc closes, restore focus on unmount. (app-shell also suppresses global Cmd
  // shortcuts via its graphOpen gate, so the overlay owns the keyboard while open.)
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, []);

  // Reset filters when the dataset's shape changes (mode/center) so a stale tag/folder filter
  // doesn't silently empty the new graph. A depth change keeps the filters.
  useEffect(() => {
    setFolderFilter("");
    setTagFilter("");
  }, [mode, centerNoteId]);

  // Fetch (or reuse cached) graph data. Race-guarded; local-with-no-note short-circuits to the
  // empty state without hitting the DB (else graph_data(null) would silently return the full graph).
  useEffect(() => {
    if (mode === "local" && !centerNoteId) {
      setData(null);
      setLoading(false);
      return;
    }
    const key = mode === "global" ? "global" : `local:${centerNoteId}:${depth}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    const mySeq = ++seqRef.current;
    setLoading(true);
    graphData(mode === "global" ? null : centerNoteId, depth)
      .then((g) => {
        if (mySeq !== seqRef.current) return;
        cacheRef.current.set(key, g);
        setData(g);
        setLoading(false);
      })
      .catch(() => {
        if (mySeq !== seqRef.current) return;
        setData({ nodes: [], edges: [] });
        setLoading(false);
      });
  }, [mode, centerNoteId, depth]);

  // Filter options derive from the fetched nodes (only folders/tags actually present in this view).
  const availableFolders = useMemo(() => {
    if (!data) return [];
    const present = new Set(data.nodes.map((n) => n.folderId).filter((x): x is string => !!x));
    return folders.filter((f) => present.has(f.id));
  }, [data, folders]);
  const availableTags = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.nodes.flatMap((n) => n.tags))].sort();
  }, [data]);

  // Client-side filter. Tag match is hierarchical (a `client` filter matches `client/toyota`), like
  // the 2.5 tag: operator; folder match is exact (MVP). Drop edges whose endpoint was filtered out
  // so force-graph never references a missing node.
  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const vis = data.nodes.filter(
      (n) =>
        (!folderFilter || n.folderId === folderFilter) &&
        (!tagFilter || n.tags.some((t) => t === tagFilter || t.startsWith(tagFilter + "/"))),
    );
    const ids = new Set(vis.map((n) => n.id));
    const visEdges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes: vis, edges: visEdges };
  }, [data, folderFilter, tagFilter]);

  const showEmptyLocal = mode === "local" && !localAvailable;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl outline-none"
      >
        {/* Controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5 text-xs">
          <span className="font-semibold uppercase tracking-wide text-neutral-400">Graph</span>

          <div className="flex overflow-hidden rounded border border-neutral-700">
            <button
              onClick={() => setMode("global")}
              className={`px-2.5 py-1 ${
                mode === "global" ? "bg-sky-600 text-white" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Global
            </button>
            <button
              onClick={() => setMode("local")}
              disabled={!localAvailable}
              title={localAvailable ? "" : "Open a note first"}
              className={`px-2.5 py-1 ${
                mode === "local" ? "bg-sky-600 text-white" : "text-neutral-300 hover:bg-neutral-800"
              } ${!localAvailable ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
            >
              Local
            </button>
          </div>

          {mode === "local" && localAvailable && (
            <div className="flex items-center gap-1.5 text-neutral-400">
              <span>Hops</span>
              <div className="flex overflow-hidden rounded border border-neutral-700">
                {([1, 2] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDepth(d)}
                    className={`px-2 py-1 ${
                      depth === d ? "bg-neutral-700 text-white" : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-200 outline-none"
          >
            <option value="">All folders</option>
            {availableFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-200 outline-none"
          >
            <option value="">All tags</option>
            {availableTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <span className="ml-auto text-neutral-500">
            {nodes.length} notes · {edges.length} links
          </span>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Close graph"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="relative min-h-0 flex-1">
          {showEmptyLocal ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              Open a note to see its local graph.
            </div>
          ) : loading && !data ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              Loading graph…
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              No notes match this filter.
            </div>
          ) : (
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              folderColors={folderColors}
              onOpenNote={(id) => {
                onOpenNote(id);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
