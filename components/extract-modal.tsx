"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Extract-to-new-note modal. A REQUIRED title for the new note carved out of the
 * editor selection (the selection itself was captured by the app-shell before opening this).
 * Mirrors the template-picker shell (focus restore, inline duplicate-title error, Esc/backdrop
 * close); the new note is created on submit and the source's selection is replaced by a link.
 */
export function ExtractModal({
  selectionLength,
  onCreate,
  onClose,
}: {
  selectionLength: number;
  onCreate: (title: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  async function submit() {
    const t = title.trim();
    if (!t) {
      setError("Title is required.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onCreate(t);
    if (res.ok) {
      onClose(); // the new note is now open in the editor
    } else {
      setError(res.message);
      setBusy(false); // stay open so the user can fix the title and retry
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-500">
          Extract {selectionLength} selected character{selectionLength === 1 ? "" : "s"} into a new note
        </div>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="New note title…   Enter creates · Esc cancels"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
        />
        {error && <div className="border-t border-neutral-800 px-4 py-2 text-xs text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded border border-sky-800 bg-sky-950/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-900/40 disabled:opacity-50"
          >
            Create note
          </button>
        </div>
      </div>
    </div>
  );
}
