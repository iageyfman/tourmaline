"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fuzzyRank } from "@/lib/search/fuzzy";
import type { NoteItem } from "./types";

/**
 * Cmd+O quick switcher. Fuzzy search over note titles. Enter opens the
 * highlighted note; Shift+Enter creates a note titled with the query (or opens it if a
 * note by that title already exists) — that branch reuses the app-shell's onCreateOrOpen.
 */
export function QuickSwitcher({
  notes,
  onOpenNote,
  onCreateOrOpen,
  onClose,
}: {
  notes: NoteItem[];
  onOpenNote: (id: string) => void;
  onCreateOrOpen: (title: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  const results = useMemo(
    () => fuzzyRank(query, notes, (n) => n.title).slice(0, 50),
    [query, notes],
  );
  useEffect(() => setSel(0), [query]);

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
      if (e.shiftKey) {
        const t = query.trim();
        if (t) {
          onCreateOrOpen(t);
          onClose();
        }
      } else {
        const hit = results[sel];
        if (hit) {
          onOpenNote(hit.id);
          onClose();
        }
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[36rem] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search notes…   Enter opens · Shift+Enter creates · Esc closes"
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-2 text-sm text-neutral-600">
              {query.trim() ? "No match — Shift+Enter to create" : "No notes"}
            </li>
          ) : (
            results.map((n, i) => (
              <li key={n.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    onOpenNote(n.id);
                    onClose();
                  }}
                  className={`block w-full truncate px-4 py-1.5 text-left text-sm ${
                    i === sel ? "bg-neutral-800 text-sky-300" : "text-neutral-200"
                  }`}
                >
                  {n.title}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
