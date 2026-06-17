"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Compose menu: a small header dropdown with the two composer actions (merge /
 * extract). The app has no dropdown primitive, so this is a minimal hand-rolled popover that
 * closes on outside-click or Escape. Each action's own gating (e.g. extract needs a non-empty
 * selection in edit mode) lives in the app-shell handler, which surfaces a hint if unmet.
 */
export function ComposeMenu({ onMerge, onExtract }: { onMerge: () => void; onExtract: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Compose (merge / extract)"
        aria-label="Compose"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded border border-neutral-700 px-1.5 py-1 hover:bg-neutral-800 ${
          open ? "text-sky-400" : "text-neutral-400"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 21V9a9 9 0 0 0 9 9" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-xl"
        >
          <button
            role="menuitem"
            onClick={() => run(onMerge)}
            className="block w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Merge into another note…
          </button>
          <button
            role="menuitem"
            onClick={() => run(onExtract)}
            className="block w-full px-3 py-2 text-left text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Extract selection to new note…
          </button>
        </div>
      )}
    </div>
  );
}
