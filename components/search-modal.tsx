"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchNotes, type SearchHit } from "@/lib/search/actions";
import type { FolderItem } from "./types";

// ts_headline wraps each match in these private-use sentinels (set in migration 0006). They can
// never appear in note bodies, so splitting on them to build <mark> spans is XSS-safe — no
// dangerouslySetInnerHTML, no literal-<b> ambiguity.
const HL_START = "\uE000";
const HL_STOP = "\uE001";

/**
 * Full-text search modal (Cmd+Shift+F). Ranked tsvector search with snippets +
 * tag:/path:/prop: operators. Mirrors the quick-switcher shell. Debounced (~200ms) with a
 * seq-counter race guard so a slow early query can't overwrite a later one. When opened with an
 * `initialQuery` (the tag-pane re-route → `tag:<name>`), it searches immediately on mount.
 */
export function SearchModal({
  initialQuery = "",
  folders,
  onOpenNote,
  onClose,
  onBookmarkSearch,
}: {
  initialQuery?: string;
  folders: FolderItem[];
  onOpenNote: (id: string) => void;
  onClose: () => void;
  onBookmarkSearch?: (query: string) => void; // ★ saves the current query as a search bookmark (3.4)
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const seqRef = useRef(0); // bumped per search; only the latest result is adopted
  const firstRef = useRef(true); // first run (mount) searches with no debounce

  const folderName = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of folders) m.set(f.id, f.name);
    return m;
  }, [folders]);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select(); // pre-select initialQuery so typing replaces it
    return () => restoreRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const isFirst = firstRef.current;
    firstRef.current = false;
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mySeq = ++seqRef.current;
    setLoading(true);
    const t = setTimeout(
      () => {
        searchNotes(query)
          .then((hits) => {
            if (mySeq !== seqRef.current) return; // a newer search superseded this one
            setResults(hits);
            setSel(0);
            setLoading(false);
          })
          .catch(() => {
            if (mySeq !== seqRef.current) return;
            setResults([]);
            setLoading(false);
          });
      },
      isFirst ? 0 : 200,
    );
    return () => clearTimeout(t);
  }, [query]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[sel];
      if (hit) {
        onOpenNote(hit.id);
        onClose();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[40rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-neutral-800">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes…   tag:x · path:folder · prop:key=value"
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
          />
          {onBookmarkSearch && (
            <button
              type="button"
              disabled={!query.trim()}
              onClick={() => onBookmarkSearch(query.trim())}
              title="Bookmark this search"
              aria-label="Bookmark this search"
              className="shrink-0 px-3 py-3 text-base text-neutral-500 hover:text-amber-400 disabled:opacity-30 disabled:hover:text-neutral-500"
            >
              ☆
            </button>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {!query.trim() ? (
            <li className="px-4 py-2 text-sm text-neutral-600">
              Type to search. Operators: <span className="text-neutral-500">tag:</span>{" "}
              <span className="text-neutral-500">path:</span>{" "}
              <span className="text-neutral-500">prop:key=value</span>
            </li>
          ) : loading && results.length === 0 ? (
            <li className="px-4 py-2 text-sm text-neutral-600">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-4 py-2 text-sm text-neutral-600">No matches.</li>
          ) : (
            results.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    onOpenNote(hit.id);
                    onClose();
                  }}
                  className={`block w-full px-4 py-2 text-left ${
                    i === sel ? "bg-neutral-800" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`min-w-0 truncate text-sm font-medium ${
                        i === sel ? "text-sky-300" : "text-neutral-200"
                      }`}
                    >
                      {hit.title}
                    </span>
                    {hit.folder_id && folderName.has(hit.folder_id) && (
                      <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                        {folderName.get(hit.folder_id)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500">
                    <Snippet text={hit.snippet} />
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/** Split the ts_headline snippet on the PUA sentinels into normal text + <mark> highlight runs. */
function Snippet({ text }: { text: string }) {
  const segs = text.split(HL_START);
  return (
    <>
      {segs.map((seg, i) => {
        if (i === 0) return <span key={i}>{seg}</span>;
        const stop = seg.indexOf(HL_STOP);
        const hit = stop === -1 ? seg : seg.slice(0, stop);
        const rest = stop === -1 ? "" : seg.slice(stop + 1);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-sky-500/25 px-0.5 text-sky-100">{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}
