"use server";

import { createServerClient } from "@/lib/supabase/server";

// Graph node/edge shapes — what the `graph_data` RPC (migration 0007) returns, one JSON object.
export interface GraphNode {
  id: string;
  title: string;
  folderId: string | null;
  degree: number; // GLOBAL distinct-neighbor count (vault-wide importance), not raw [[link]] count
  tags: string[];
}
export interface GraphEdge {
  source: string;
  target: string;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Graph data (features 3.1 full graph + 3.2 local graph) — the first feature to read the `links`
 * table as an edge SET, via the read-only `graph_data` RPC. `centerId` null → the full vault
 * (every live note, incl. orphans, + all resolved non-self edges); a note id → that note's ego
 * network within `depth` undirected hops (same component, scoped query — SPEC 3.2). READ action:
 * throws on error (like getBacklinks / searchNotes), no discriminated result.
 *
 * `depth` is CLAMPED to [1,2]. The RPC's recursive BFS terminates via its `dist < p_depth` guard
 * (it carries no visited-set), so depth must never exceed 2 — that clamp is the real termination
 * guarantee and keeps the SQL body plain. The UI only ever requests 1 or 2.
 */
export async function graphData(centerId: string | null, depth = 2): Promise<GraphData> {
  const p_depth = Math.min(Math.max(depth, 1), 2);
  const { data, error } = await createServerClient().rpc("graph_data", {
    p_center: centerId,
    p_depth,
  });
  if (error) throw new Error(error.message);
  const g = (data ?? {}) as Partial<GraphData>;
  return { nodes: g.nodes ?? [], edges: g.edges ?? [] };
}
