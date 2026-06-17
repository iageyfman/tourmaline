"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fuzzyRank } from "@/lib/search/fuzzy";
import type { NoteItem } from "./types";

/**
 * Merge picker. Pick a TARGET note B to fold the open note A into; a confirmation
 * step guards A's soft-delete. Fuzzy title search excludes A. Mirrors the quick-switcher shell
 * (focus restore, backdrop close); Escape backs out of the confirmation, then closes.
 */
export function MergePicker({
  notes,
  sourceId,
  sourceTitle,
  onConfirm,
  onClose,
}: {
  notes: NoteItem[];
  sourceId: string;
  sourceTitle: string;
  onConfirm: (targetId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [target, setTarget] = useState<NoteItem | null>(null); // set → confirmation phase
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  // Escape backs out of the confirmation; from the list it closes. (Two phases → a document
  // listener is cleaner than the input's onKeyDown; re-registers when `target` changes.)
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (target) setTarget(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  const candidates = useMemo(() => notes.filter((n) => n.id !== sourceId), [notes, sourceId]);
  const results = useMemo(() => fuzzyRank(query, candidates, (n) => n.title).slice(0, 50), [query, candidates]);
  useEffect(() => setSel(0), [query]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[sel];
      if (hit) setTarget(hit);
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
        {target ? (
          <div className="p-4">
            <p className="text-sm text-neutral-200">
              Merge <span className="font-medium text-sky-300">{sourceTitle}</span> into{" "}
              <span className="font-medium text-sky-300">{target.title}</span>?
            </p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              {sourceTitle}&rsquo;s content is appended to {target.title}, inbound links repoint to{" "}
              {target.title}, and {sourceTitle} is moved to trash.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Back
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  onConfirm(target.id);
                  onClose();
                }}
                className="rounded border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40"
              >
                Merge into {target.title}
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Merge "${sourceTitle}" into…   ↑↓ pick · Enter selects · Esc cancels`}
              className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
            />
            <ul className="max-h-80 overflow-auto py-1">
              {results.length === 0 ? (
                <li className="px-4 py-2 text-sm text-neutral-600">No other notes</li>
              ) : (
                results.map((n, i) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => setTarget(n)}
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
          </>
        )}
      </div>
    </div>
  );
}
