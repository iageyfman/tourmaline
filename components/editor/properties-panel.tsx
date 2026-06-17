"use client";

import { useState, type ReactNode } from "react";

/**
 * Properties panel (SPEC 2.4): the note's frontmatter as a typed key/value table above the
 * body. It DISPLAYS `properties` (already parsed server-side — no parsing here, hard-rule #1)
 * and edits write back by calling the parent, which rewrites the body's YAML server-side and
 * re-saves through the pipeline. Typed rows: checkbox / date / number / list / text; nested
 * objects are read-only. Dates are detected by shape — the pipeline parses YAML dates as
 * strings, never `Date`.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function csvToList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
}

export function PropertiesPanel({
  noteId,
  properties,
  onSetProperty,
  onDeleteProperty,
}: {
  noteId: string;
  properties: Record<string, unknown>;
  onSetProperty: (key: string, value: unknown) => void;
  onDeleteProperty: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  // Invalid YAML: the pipeline stored {_raw_error,_raw}; editing is disabled server-side too.
  if ("_raw_error" in properties) {
    return (
      <div className="border-b border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400">
        ⚠ Invalid YAML frontmatter — fix it directly in the note; the properties table is disabled until then.
      </div>
    );
  }

  const keys = Object.keys(properties).filter((k) => k !== "_raw" && k !== "_raw_error");

  function addProperty() {
    const k = newKey.trim();
    if (!k) return;
    onSetProperty(k, newVal); // value typed as string; user can refine the typed editor after
    setNewKey("");
    setNewVal("");
    setAdding(false);
  }

  if (keys.length === 0 && !adding) {
    return (
      <div className="border-b border-neutral-800 px-4 py-1.5">
        <button onClick={() => setAdding(true)} className="text-xs text-neutral-600 hover:text-neutral-300">
          ＋ add property
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-neutral-800 px-4 py-2 text-sm">
      {keys.length > 0 && (
        <table className="w-full border-collapse">
          <tbody>
            {keys.map((k) => (
              <PropertyRow
                key={`${noteId}:${k}`}
                propKey={k}
                value={properties[k]}
                onSet={onSetProperty}
                onDelete={onDeleteProperty}
              />
            ))}
          </tbody>
        </table>
      )}
      {adding ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            autoFocus
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key"
            className="w-32 rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-xs outline-none"
          />
          <input
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addProperty();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="value"
            className="flex-1 rounded border border-neutral-700 bg-transparent px-2 py-0.5 text-xs outline-none"
          />
          <button onClick={addProperty} className="rounded px-2 py-0.5 text-xs text-sky-400 hover:bg-neutral-800">add</button>
          <button onClick={() => setAdding(false)} className="rounded px-1 text-xs text-neutral-500 hover:bg-neutral-800">✕</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-1 text-xs text-neutral-600 hover:text-neutral-300">
          ＋ add property
        </button>
      )}
    </div>
  );
}

function PropertyRow({
  propKey,
  value,
  onSet,
  onDelete,
}: {
  propKey: string;
  value: unknown;
  onSet: (key: string, value: unknown) => void;
  onDelete: (key: string) => void;
}) {
  let editor: ReactNode;
  if (typeof value === "boolean") {
    editor = (
      <input type="checkbox" checked={value} onChange={(e) => onSet(propKey, e.target.checked)} className="accent-sky-500" />
    );
  } else if (typeof value === "number") {
    editor = (
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value === "") return;
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && n !== value) onSet(propKey, n);
        }}
        className="w-full bg-transparent outline-none"
      />
    );
  } else if (Array.isArray(value)) {
    editor = (
      <input
        type="text"
        defaultValue={value.join(", ")}
        onBlur={(e) => {
          const list = csvToList(e.target.value);
          if (JSON.stringify(list) !== JSON.stringify(value)) onSet(propKey, list);
        }}
        className="w-full bg-transparent outline-none"
      />
    );
  } else if (typeof value === "string" && DATE_RE.test(value)) {
    editor = (
      <input
        type="date"
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value && e.target.value !== value) onSet(propKey, e.target.value);
        }}
        className="bg-transparent text-neutral-200 outline-none [color-scheme:dark]"
      />
    );
  } else if (typeof value === "string") {
    editor = (
      <input
        type="text"
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value !== value) onSet(propKey, e.target.value);
        }}
        className="w-full bg-transparent outline-none"
      />
    );
  } else if (isPlainObject(value)) {
    editor = <code className="text-xs text-neutral-500">{JSON.stringify(value)}</code>;
  } else {
    // null / undefined → edit as text
    const asText = value == null ? "" : String(value);
    editor = (
      <input
        type="text"
        defaultValue={asText}
        onBlur={(e) => {
          if (e.target.value !== asText) onSet(propKey, e.target.value);
        }}
        className="w-full bg-transparent outline-none"
      />
    );
  }

  return (
    <tr className="group">
      <td className="w-32 py-0.5 pr-3 align-top text-xs font-medium text-neutral-400">{propKey}</td>
      <td className="py-0.5 align-top text-neutral-200">{editor}</td>
      <td className="w-6 py-0.5 text-right align-top">
        <button
          onClick={() => onDelete(propKey)}
          title={`Delete ${propKey}`}
          className="text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
