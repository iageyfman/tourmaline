"use client";

import { useMemo, useState } from "react";
import type { View, ViewFilter, ViewRow } from "@/lib/views/types";
import type { ViewInput } from "@/lib/views/actions";
import type { FolderItem } from "@/components/types";
import { sortViewRows } from "@/lib/views/sort";
import { unionPropertyKeys, rowHasInvalidYaml } from "@/lib/views/columns";
import { coerceCellValue } from "@/lib/views/coerce";
import { ViewFilterEditor } from "./view-filter-editor";

/**
 * The center-pane view: a saved filter rendered as a table or card grid of
 * matching notes, with chosen property columns, client-side sort, and inline property edit.
 * Filtering runs server-side (runView → notes_for_view); sort + column projection happen here.
 * Inline edits go through `setNoteProperty` (parent), re-derived by the save pipeline — never a
 * direct `properties` write. Rows are point-in-time: editing re-sorts but does NOT re-filter
 * (reopening the view re-fetches). Parent keys this by view id so switching views resets state.
 */
export function ViewPane({
  view,
  rows,
  loading,
  error,
  folders,
  onUpdateView,
  onApplyFilter,
  onOpenNote,
  onSetCellProperty,
}: {
  view: View;
  rows: ViewRow[];
  loading: boolean;
  error: string | null;
  folders: FolderItem[];
  onUpdateView: (patch: Partial<ViewInput>) => void;
  onApplyFilter: (filter: ViewFilter) => void;
  onOpenNote: (id: string) => void;
  onSetCellProperty: (noteId: string, key: string, value: unknown) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);

  const sorted = useMemo(() => sortViewRows(rows, view.sort), [rows, view.sort]);
  const available = useMemo(() => unionPropertyKeys(rows), [rows]);
  const columns = view.columns;

  const sortOptions = [
    { value: "title", label: "Title" },
    { value: "updated", label: "Updated" },
    { value: "created", label: "Created" },
    ...columns.map((c) => ({ value: c, label: c })),
  ];
  if (!sortOptions.some((o) => o.value === view.sort.key)) {
    sortOptions.push({ value: view.sort.key, label: view.sort.key });
  }

  function toggleColumn(key: string) {
    const next = columns.includes(key) ? columns.filter((c) => c !== key) : [...columns, key];
    onUpdateView({ columns: next });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* ── header ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-3 border-b border-neutral-800 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            key={view.id}
            defaultValue={view.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== view.name) onUpdateView({ name: v });
            }}
            aria-label="View name"
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-neutral-100 outline-none"
          />

          {/* layout toggle */}
          <div className="flex overflow-hidden rounded border border-neutral-700 text-xs">
            {(["table", "cards"] as const).map((l) => (
              <button
                key={l}
                onClick={() => view.layout !== l && onUpdateView({ layout: l })}
                className={`px-2 py-1 capitalize ${
                  view.layout === l ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* sort */}
          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <span>sort</span>
            <select
              value={view.sort.key}
              onChange={(e) => onUpdateView({ sort: { key: e.target.value, dir: view.sort.dir } })}
              className="rounded border border-neutral-700 bg-transparent px-1.5 py-1 outline-none focus:border-sky-600"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                onUpdateView({ sort: { key: view.sort.key, dir: view.sort.dir === "asc" ? "desc" : "asc" } })
              }
              title={view.sort.dir === "asc" ? "Ascending" : "Descending"}
              aria-label="Toggle sort direction"
              className="rounded border border-neutral-700 px-1.5 py-1 hover:bg-neutral-800"
            >
              {view.sort.dir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>

        {/* filter summary + toggle */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500">Filter:</span>
          <span className="text-neutral-300">{filterSummary(view.filter)}</span>
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className="ml-1 text-sky-400 hover:text-sky-300"
          >
            {filterOpen ? "close" : "edit"}
          </button>
          <span className="ml-auto text-neutral-600">{rows.length} note{rows.length === 1 ? "" : "s"}</span>
        </div>
        {filterOpen && (
          <ViewFilterEditor
            key={view.id}
            filter={view.filter}
            folders={folders}
            onApply={(f) => {
              onApplyFilter(f);
              setFilterOpen(false);
            }}
          />
        )}

        {/* column picker */}
        {available.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-neutral-500">Columns:</span>
            {available.map((k) => {
              const on = columns.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => toggleColumn(k)}
                  className={`rounded-full border px-2 py-0.5 ${
                    on
                      ? "border-sky-700 bg-sky-950/60 text-sky-200"
                      : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-neutral-600">No properties on these notes — add frontmatter to populate columns.</div>
        )}

        {error && (
          <div className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-400">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* ── body ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="text-sm text-neutral-600">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-neutral-600">No notes match this view.</div>
        ) : view.layout === "cards" ? (
          <CardGrid rows={sorted} columns={columns} onOpenNote={onOpenNote} onSetCellProperty={onSetCellProperty} />
        ) : (
          <Table rows={sorted} columns={columns} onOpenNote={onOpenNote} onSetCellProperty={onSetCellProperty} />
        )}
      </div>
    </div>
  );
}

function filterSummary(f: ViewFilter): string {
  const parts: string[] = [];
  if (f.tag) parts.push(`tag:${f.tag}`);
  if (f.path) parts.push(`folder:${f.path}`);
  for (const p of f.props) parts.push(p.value === null ? `${p.key} (exists)` : `${p.key}=${p.value}`);
  return parts.length ? parts.join("  ·  ") : "All notes";
}

interface BodyProps {
  rows: ViewRow[];
  columns: string[];
  onOpenNote: (id: string) => void;
  onSetCellProperty: (noteId: string, key: string, value: unknown) => void;
}

function Table({ rows, columns, onOpenNote, onSetCellProperty }: BodyProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-1.5 pr-4 font-medium">Title</th>
          {columns.map((c) => (
            <th key={c} className="py-1.5 pr-4 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const locked = rowHasInvalidYaml(r);
          return (
            <tr key={r.id} className="border-b border-neutral-900 hover:bg-neutral-900/40">
              <td className="py-1 pr-4 align-top">
                <button
                  onClick={() => onOpenNote(r.id)}
                  className="text-left text-sky-300 hover:underline"
                  title={locked ? "Invalid frontmatter — open to fix" : r.title}
                >
                  {r.title}
                  {locked && <span className="ml-1 text-amber-500" title="Invalid YAML frontmatter">⚠</span>}
                </button>
              </td>
              {columns.map((c) => (
                <td key={c} className="py-1 pr-4 align-top text-neutral-200">
                  <PropertyCell
                    value={r.properties?.[c]}
                    editable={!locked}
                    onSet={(v) => onSetCellProperty(r.id, c, v)}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CardGrid({ rows, columns, onOpenNote, onSetCellProperty }: BodyProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {rows.map((r) => {
        const locked = rowHasInvalidYaml(r);
        return (
          <div key={r.id} className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
            <button
              onClick={() => onOpenNote(r.id)}
              className="mb-2 block text-left font-medium text-sky-300 hover:underline"
            >
              {r.title}
              {locked && <span className="ml-1 text-amber-500" title="Invalid YAML frontmatter">⚠</span>}
            </button>
            {columns.length === 0 ? (
              <div className="text-xs text-neutral-600">No columns selected.</div>
            ) : (
              <dl className="space-y-1 text-sm">
                {columns.map((c) => (
                  <div key={c} className="flex items-baseline gap-2">
                    <dt className="w-20 shrink-0 truncate text-xs text-neutral-500">{c}</dt>
                    <dd className="min-w-0 flex-1 text-neutral-200">
                      <PropertyCell
                        value={r.properties?.[c]}
                        editable={!locked}
                        onSet={(v) => onSetCellProperty(r.id, c, v)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A read-only display string for a cell value (cards labels / locked rows / array+object). */
function formatDisplay(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

/** The editable text for a cell (arrays as CSV; everything scalar as its string form). */
function formatEditable(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * One property cell. Typed by the existing value: boolean → checkbox, object → read-only JSON,
 * everything else → a text input committed on blur via `coerceCellValue` (type-anchored, so a
 * number stays a number). A blank cell creates the key on first edit.
 */
function PropertyCell({
  value,
  editable,
  onSet,
}: {
  value: unknown;
  editable: boolean;
  onSet: (value: unknown) => void;
}) {
  if (!editable) {
    return <span className="text-neutral-400">{formatDisplay(value) || "—"}</span>;
  }
  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onSet(e.target.checked)}
        className="accent-sky-500"
      />
    );
  }
  if (isPlainObject(value)) {
    return <code className="text-xs text-neutral-500">{JSON.stringify(value)}</code>;
  }
  const text = formatEditable(value);
  return (
    <input
      key={text}
      type="text"
      defaultValue={text}
      placeholder="—"
      onBlur={(e) => {
        if (e.target.value !== text) onSet(coerceCellValue(value, e.target.value));
      }}
      className="w-full bg-transparent outline-none placeholder:text-neutral-700"
    />
  );
}
