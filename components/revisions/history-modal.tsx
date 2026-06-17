"use client";

import { useEffect, useRef, useState } from "react";
import { getRevision, type RevisionMeta } from "@/lib/revisions/actions";

/**
 * Version history: a per-note revision browser. Left = the revision list (newest
 * first); right = the selected revision's raw body, read-only (no diff — by design, no diffing
 * cleverness). "Restore this version" hands the id to the parent, which applies it (and the
 * pipeline writes a new revision). Mirrors the search-modal shell (Esc / backdrop close / focus
 * restore). The body fetch is seq-guarded so a slow load can't overwrite a newer selection.
 */
export function HistoryModal({
  revisions,
  currentTitle,
  onRestore,
  onClose,
}: {
  revisions: RevisionMeta[];
  currentTitle: string;
  onRestore: (revisionId: string) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(revisions[0]?.id ?? null);
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const restoreRef = useRef<HTMLElement | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (!selectedId) {
      setBody(null);
      return;
    }
    const mySeq = ++seqRef.current;
    setLoading(true);
    getRevision(selectedId)
      .then((r) => {
        if (mySeq !== seqRef.current) return;
        setBody(r.body);
        setLoading(false);
      })
      .catch(() => {
        if (mySeq !== seqRef.current) return;
        setBody(null);
        setLoading(false);
      });
  }, [selectedId]);

  const selected = revisions.find((r) => r.id === selectedId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-[52rem] max-w-[94vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* revision list */}
        <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800">
          <div className="shrink-0 border-b border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            History ({revisions.length})
          </div>
          <ul className="min-h-0 flex-1 overflow-auto py-1">
            {revisions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-600">No revisions yet.</li>
            ) : (
              revisions.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    title={new Date(r.created_at).toLocaleString()}
                    className={`block w-full px-3 py-2 text-left ${
                      r.id === selectedId ? "bg-neutral-800" : "hover:bg-neutral-800/50"
                    }`}
                  >
                    <div className={`text-xs ${r.id === selectedId ? "text-sky-300" : "text-neutral-300"}`}>
                      {relativeTime(r.created_at)}
                    </div>
                    {r.title !== currentTitle && (
                      <div className="mt-0.5 truncate text-[11px] text-neutral-500" title={r.title}>
                        {r.title}
                      </div>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* selected revision */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-300">
              {selected ? `${selected.title} · ${new Date(selected.created_at).toLocaleString()}` : "Select a revision"}
            </span>
            <button
              type="button"
              disabled={!selectedId}
              onClick={() => selectedId && onRestore(selectedId)}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-sky-300 disabled:opacity-30"
            >
              Restore this version
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {loading && body === null ? (
              <p className="text-sm text-neutral-600">Loading…</p>
            ) : body === null ? (
              <p className="text-sm text-neutral-600">Select a revision to view it.</p>
            ) : body === "" ? (
              <p className="text-sm italic text-neutral-600">(empty note)</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-300">
                {body}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dependency-free relative time ("just now" / "5m ago" / "3h ago" / "2d ago" / a date). */
function relativeTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
