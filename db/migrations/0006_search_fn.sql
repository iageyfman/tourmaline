-- Tourmaline — full-text search (read-only function).
-- generated notes.search_tsv (title weight A + body weight B; GIN: notes_search_idx).
--
-- Operators tag:/path:/prop: are parsed OUTSIDE the DB (lib/search/query.ts) and passed
-- as discrete params, so this function does NO note-content parsing. All filters AND
-- together; results rank by ts_rank then recency.
--
--   p_query  free-text → websearch_to_tsquery('english', …). websearch is TOTAL (never
--            throws on junk input). Blank → NULL tsq → no text filter (operator-only search).
--   p_tag    one tag; matches it OR any descendant (name || '/…'), reusing the 0005
--            notes_by_tag predicate (starts_with, not LIKE, so '_'/'%' can't over-match).
--   p_path   one folder NAME; matches notes in that folder OR any nested subfolder. Folder
--            names are NOT unique, so this seeds from EVERY folder of that name (⚠️ MVP).
--   p_props  [{"key":"k","value":"v"|null}]; ALL must match. value null = key existence;
--            value set = case-insensitive text-equality on properties->>key AND key exists.
create or replace function search_notes(
  p_query text,
  p_tag   text default null,
  p_path  text default null,
  p_props jsonb default '[]'::jsonb,
  p_limit int default 50
)
returns table(id uuid, title text, folder_id uuid, snippet text, rank real, updated_at timestamptz)
language sql
stable
as $$
  with recursive
  q as (
    select case when coalesce(trim(p_query), '') = '' then null
                else websearch_to_tsquery('english', p_query) end as tsq
  ),
  path_folders as (
    -- ⚠️ folder names NOT unique -> seeds from ALL folders named p_path, unions every subtree.
    select f.id from folders f where p_path is not null and lower(f.name) = lower(p_path)
    union all
    select c.id from folders c join path_folders pf on c.parent_id = pf.id
  )
  select
    n.id,
    n.title,
    n.folder_id,
    case when (select tsq from q) is not null
         then ts_headline('english', n.body, (select tsq from q),
                'StartSel=' || chr(57344) || ',StopSel=' || chr(57345) ||
                ',MaxFragments=2,MaxWords=18,MinWords=5')
         else left(n.body, 160) end as snippet,
    case when (select tsq from q) is not null
         then ts_rank(n.search_tsv, (select tsq from q)) else 0 end as rank,
    n.updated_at
  from notes n
  where n.deleted_at is null
    and ((select tsq from q) is null or n.search_tsv @@ (select tsq from q))
    and (p_tag is null or exists (
          select 1 from note_tags nt join tags t on t.id = nt.tag_id
          where nt.note_id = n.id
            and (t.name = lower(p_tag) or starts_with(t.name, lower(p_tag) || '/'))))
    and (p_path is null or n.folder_id in (select id from path_folders))
    and (not exists (
          select 1 from jsonb_array_elements(coalesce(p_props, '[]'::jsonb)) pp
          where not (
            case when pp->>'value' is null
                 then n.properties ? (pp->>'key')
                 else (n.properties ? (pp->>'key')
                       and lower(n.properties->>(pp->>'key')) = lower(pp->>'value'))
            end)))
  order by rank desc, n.updated_at desc
  limit greatest(p_limit, 1);
$$;
