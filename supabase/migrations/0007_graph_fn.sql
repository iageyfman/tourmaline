-- Tourmaline — full + local graph data.
-- One read-only function powers both modes via p_center:
--   p_center null  → full graph (all live notes incl. orphans + all resolved non-self edges);
--   p_center set   → ego network within p_depth undirected hops (recursive BFS), edges induced.
-- Edges are canonicalized (least/greatest) + deduped so reciprocal links never double-draw;
-- self-links excluded; both endpoints must be live. degree = GLOBAL distinct-neighbor count.
-- p_depth is clamped to [1,2] in the server action (lib/graph/actions.ts) — that is the real
-- termination guarantee for the recursion (the UNION carries no visited-set).
--
-- ⚠️ Backfilled later: an earlier change applied this function out-of-band but the file was
-- never written to the repo. The function already exists live; this only re-syncs the
-- migrations dir so `supabase db reset` can rebuild graph_data from scratch.
create or replace function graph_data(p_center uuid default null, p_depth int default 2)
returns jsonb
language sql stable as $$
  with recursive
  edges_all as (  -- resolved, live-both-ends, non-self; canonicalized undirected pair, deduped
    select distinct least(l.source_id, l.target_id) as src, greatest(l.source_id, l.target_id) as tgt
    from links l
    join notes ns on ns.id = l.source_id and ns.deleted_at is null
    join notes nt on nt.id = l.target_id and nt.deleted_at is null
    where l.target_id is not null and l.source_id <> l.target_id
  ),
  adj as (  -- undirected adjacency for BFS + degree
    select src as a, tgt as b from edges_all
    union
    select tgt as a, src as b from edges_all
  ),
  reachable as (  -- p_center null => all notes (recursive arm short-circuits); else BFS to p_depth
    select n.id, 0 as dist
    from notes n
    where n.deleted_at is null and (p_center is null or n.id = p_center)
    union
    select adj.b, r.dist + 1
    from reachable r join adj on adj.a = r.id
    where p_center is not null and r.dist < p_depth
  ),
  node_ids as (select distinct id from reachable),
  deg as (select a as id, count(distinct b) as degree from adj group by a)  -- GLOBAL distinct-neighbor (⚠ not raw link count)
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'title', n.title, 'folderId', n.folder_id,
        'degree', coalesce(d.degree, 0),
        'tags', coalesce((select jsonb_agg(t.name order by t.name)
                          from note_tags nt join tags t on t.id = nt.tag_id
                          where nt.note_id = n.id), '[]'::jsonb)))
      from notes n join node_ids ni on ni.id = n.id
      left join deg d on d.id = n.id), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source', e.src, 'target', e.tgt))
      from edges_all e join node_ids s on s.id = e.src join node_ids t on t.id = e.tgt), '[]'::jsonb)
  );
$$;
