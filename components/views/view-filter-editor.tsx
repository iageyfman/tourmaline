"use client";

import { useState } from "react";
import type { ViewFilter } from "@/lib/views/types";
import type { FolderItem } from "@/components/types";

/**
 * The filter sub-form for a saved view: one tag (+descendants), one folder
 * path (+subtree), and N property clauses (key + optional value; blank value = "key exists").
 * Mirrors the `search_notes` operator set. Edits are LOCAL until "Apply filter" so we don't
 * re-run the query (and re-save the view) on every keystroke. Parent keys this by view id, so
 * switching views re-seeds the draft from props.
 */
export function ViewFilterEditor({
  filter,
  folders,
  onApply,
}: {
  filter: ViewFilter;
  folders: FolderItem[];
  onApply: (filter: ViewFilter) => void;
}) {
  const [tag, setTag] = useState(filter.tag ?? "");
  const [path, setPath] = useState(filter.path ?? "");
  const [props, setProps] = useState<{ key: string; value: string }[]>(
    (filter.props ?? []).map((p) => ({ key: p.key, value: p.value ?? "" })),
  );

  const folderNames = Array.from(new Set(folders.map((f) => f.name))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  function setProp(i: number, patch: Partial<{ key: string; value: string }>) {
    setProps((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function apply() {
    onApply({
      tag: tag.trim() || null,
      path: path.trim() || null,
      // blank value → null (key-existence), matching notes_for_view's `value is null` branch.
      props: props
        .map((p) => ({ key: p.key.trim(), value: p.value.trim() === "" ? null : p.value }))
        .filter((p) => p.key.length > 0),
    });
  }

  const field = "rounded border border-neutral-700 bg-transparent px-2 py-1 text-xs outline-none focus:border-sky-600";

  return (
    <div className="space-y-2 rounded border border-neutral-800 bg-neutral-900/50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          tag
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="any"
            className={`${field} w-32`}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          folder
          <select value={path} onChange={(e) => setPath(e.target.value)} className={`${field} w-36`}>
            <option value="">any</option>
            {folderNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1">
        {props.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={p.key}
              onChange={(e) => setProp(i, { key: e.target.value })}
              placeholder="property"
              className={`${field} w-32`}
            />
            <span className="text-xs text-neutral-600">=</span>
            <input
              value={p.value}
              onChange={(e) => setProp(i, { value: e.target.value })}
              placeholder="value (blank = exists)"
              className={`${field} w-44`}
            />
            <button
              onClick={() => setProps((prev) => prev.filter((_, idx) => idx !== i))}
              aria-label="Remove property filter"
              className="rounded px-1 text-xs text-neutral-600 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setProps((prev) => [...prev, { key: "", value: "" }])}
          className="text-xs text-neutral-600 hover:text-neutral-300"
        >
          ＋ property filter
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={apply}
          className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
        >
          Apply filter
        </button>
      </div>
    </div>
  );
}
