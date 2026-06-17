"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * New-note-from-template picker. A title field + the list of templates (notes
 * in the Templates folder). Type a title, ↑/↓ to pick a template, Enter creates an unfiled
 * note from it (vars substituted server-side). The title field — rather than window.prompt —
 * keeps focus inside the modal and lets a duplicate-title error show inline so the user can
 * retry. A blank title is allowed (the server auto-names it "Untitled").
 */
export interface TemplateItem {
  id: string;
  title: string;
}

export function TemplatePicker({
  templates,
  onCreate,
  onClose,
}: {
  templates: TemplateItem[];
  onCreate: (templateId: string, title: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  async function submit(index: number) {
    const tpl = templates[index];
    if (!tpl || busy) return;
    setBusy(true);
    setError(null);
    const res = await onCreate(tpl.id, title.trim());
    if (res.ok) {
      onClose(); // the new note is now open in the editor
    } else {
      setError(res.message);
      setBusy(false); // stay open so the user can fix the title and retry
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, templates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit(sel);
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
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="New note title…   ↑↓ pick template · Enter creates · Esc closes"
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
        />
        {error && (
          <div className="border-b border-neutral-800 px-4 py-2 text-xs text-red-400">{error}</div>
        )}
        <ul className="max-h-80 overflow-auto py-1">
          {templates.length === 0 ? (
            <li className="px-4 py-3 text-sm text-neutral-500">
              No templates. Create notes in a folder named{" "}
              <span className="text-neutral-300">Templates</span> to use them here.
            </li>
          ) : (
            templates.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => void submit(i)}
                  className={`block w-full truncate px-4 py-1.5 text-left text-sm disabled:opacity-50 ${
                    i === sel ? "bg-neutral-800 text-sky-300" : "text-neutral-200"
                  }`}
                >
                  {t.title}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
