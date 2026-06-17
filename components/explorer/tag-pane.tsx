"use client";

import { useMemo, useState } from "react";
import { buildTagTree, type TagNode } from "@/lib/tags/tree";

/**
 * Tag pane (SPEC 2.3): the nested `#tag` tree with counts, in the left sidebar. Read-only
 * over the derived tags table; clicking a tag asks the parent to list matching notes.
 */
export function TagPane({
  tags,
  onTagClick,
}: {
  tags: { name: string; count: number }[];
  onTagClick: (name: string) => void;
}) {
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  if (tags.length === 0) {
    return <div className="p-3 text-xs text-neutral-600">No tags yet. Add #tags to your notes.</div>;
  }
  return (
    <div className="h-full overflow-auto p-2">
      {tree.map((node) => (
        <TagTreeNode key={node.name} node={node} depth={0} onTagClick={onTagClick} />
      ))}
    </div>
  );
}

function TagTreeNode({
  node,
  depth,
  onTagClick,
}: {
  node: TagNode;
  depth: number;
  onTagClick: (name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-1 rounded py-0.5 pr-1 text-sm hover:bg-neutral-800"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {hasChildren ? (
          <button onClick={() => setOpen((o) => !o)} className="w-4 shrink-0 text-neutral-500">
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button onClick={() => onTagClick(node.name)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span className="truncate text-neutral-200">#{node.label}</span>
          {/* exact-tag count, or a dimmed descendant roll-up for hierarchy-only parents */}
          <span className={`shrink-0 text-xs ${node.ownCount > 0 ? "text-neutral-500" : "text-neutral-700"}`}>
            {node.ownCount > 0 ? node.ownCount : hasChildren ? node.totalCount : ""}
          </span>
        </button>
      </div>
      {hasChildren && open && node.children.map((c) => (
        <TagTreeNode key={c.name} node={c} depth={depth + 1} onTagClick={onTagClick} />
      ))}
    </div>
  );
}
