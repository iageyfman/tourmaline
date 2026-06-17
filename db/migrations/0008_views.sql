-- Tourmaline — saved database-style views (table / card grids over a filter).
--
-- This is the first new table since the initial schema.
--
-- A `view` is a saved filter (tag/folder/property) + chosen property columns + sort +
-- layout. Filtering runs in SQL (notes_for_view, below); sort + column projection are
-- done client-side over the returned set (no dynamic order-by over a JSONB key).

create table views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  filter     jsonb not null default '{}'::jsonb,   -- {tag:str|null, path:str|null, props:[{key,value}]}
  columns    jsonb not null default '[]'::jsonb,   -- ordered property-key strings to show
  sort       jsonb not null default '{}'::jsonb,   -- {key, dir:'asc'|'desc'}
  layout     text  not null default 'table' check (layout in ('table', 'cards')),
  created_at timestamptz not null default now()
);

-- Read-only filtered projection for a view. The three predicates (tag-descendant,
-- path-subtree CTE, prop AND-match over the properties JSONB) are copied VERBATIM from
-- search_notes (0006) — minus tsquery/rank/snippet/limit — so view filtering and the 2.5
-- `tag:`/`path:`/`prop:` operators behave identically. It returns `properties` (for the
-- column cells) instead of a snippet. NO note-content parsing here: the filter arrives
-- as discrete params. NO limit: a "database view" shows every match.
--
--   p_tag    one tag; matches it OR any descendant (name || '/...').
--   p_path   one folder NAME; matches notes in that folder OR any nested subfolder.
--            Folder names are NOT unique, so this seeds from EVERY folder of that name.
--   p_props  [{"key":k,"value":v|null}]; ALL must match. value null = key existence;
--            value set = case-insensitive text-equality on properties->>key AND key exists.
create or replace function notes_for_view(
  p_tag   text  default null,
  p_path  text  default null,
  p_props jsonb default '[]'::jsonb
)
returns table(id uuid, title text, folder_id uuid, properties jsonb,
              created_at timestamptz, updated_at timestamptz)
language sql
stable
as $$
  with recursive path_folders as (
    -- ⚠️ folder names NOT unique -> seeds from ALL folders named p_path, unions every subtree.
    select f.id from folders f where p_path is not null and lower(f.name) = lower(p_path)
    union all
    select c.id from folders c join path_folders pf on c.parent_id = pf.id
  )
  select n.id, n.title, n.folder_id, n.properties, n.created_at, n.updated_at
  from notes n
  where n.deleted_at is null
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
  order by lower(n.title), n.id;
$$;
