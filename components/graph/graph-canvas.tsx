"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphProps, NodeObject } from "react-force-graph-2d";
import type { GraphNode, GraphEdge } from "@/lib/graph/actions";
import { folderColor } from "@/lib/graph/colors";

// react-force-graph-2d touches window/canvas at import → load it client-only (this repo's first
// dynamic import). next/dynamic can't infer the package's generic default export, so cast the
// result to a usable typed component; node/link accessor args arrive as loosely-typed NodeObjects.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ComponentType<ForceGraphProps>;

export function GraphCanvas({
  nodes,
  edges,
  folderColors,
  onOpenNote,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  folderColors: Map<string, string>;
  onOpenNote: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ForceGraph2D defaults its canvas to window size when width/height are unset — wrong inside a
  // modal. Measure the container and pass explicit pixels; gate the first paint on a non-zero width.
  // Seed the size SYNCHRONOUSLY on mount (the effect runs post-layout, so clientWidth is real) —
  // don't depend on the ResizeObserver's initial callback, which some headless environments never
  // dispatch. The observer then handles later resizes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hand force-graph FRESH link objects: it rewrites link.source/target from ids into node refs
  // in place, so we never pass the parent's pristine (string-id) edges. That keeps the parent's
  // client-side filtering — which reads those string ids — correct across re-renders. Nodes ARE
  // passed through unchanged so force-graph's in-place x/y survive (stable layout on filter).
  const links = useMemo(() => edges.map((e) => ({ source: e.source, target: e.target })), [edges]);

  return (
    <div ref={wrapRef} className="h-full w-full">
      {size.w > 0 && (
        <ForceGraph2D
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          graphData={{ nodes, links }}
          nodeRelSize={5}
          nodeVal={(n: NodeObject) => Math.max(1, (n as unknown as GraphNode).degree)}
          nodeColor={(n: NodeObject) =>
            folderColor(folderColors, (n as unknown as GraphNode).folderId)
          }
          nodeLabel={(n: NodeObject) => (n as unknown as GraphNode).title}
          onNodeClick={(n: NodeObject) => onOpenNote(String(n.id))}
          linkColor={() => "rgba(148,163,184,0.25)"}
          linkWidth={1}
          warmupTicks={20}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(n: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
            const node = n as unknown as GraphNode;
            // Label hubs always; everything else only when zoomed in — keeps the canvas readable.
            if (node.degree < 2 && scale <= 1.5) return;
            const x = n.x;
            const y = n.y;
            if (x == null || y == null) return;
            const fontSize = Math.max(2.5, 11 / scale);
            ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(226,232,240,0.85)";
            const r = Math.sqrt(Math.max(1, node.degree)) * 5; // ≈ nodeRelSize · sqrt(nodeVal)
            ctx.fillText(node.title, x, y + r + 1.5);
          }}
        />
      )}
    </div>
  );
}
