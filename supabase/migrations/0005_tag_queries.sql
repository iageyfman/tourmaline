-- Tourmaline — tag-pane read queries.
--
-- Both functions are read-only aggregations over the DERIVED tags/note_tags tables
-- (rebuilt every save by rebuild_note_derived); nothing writes them here.

-- All tags with a distinct-note count. INNER joins are deliberate: they drop orphan
-- `tags` rows (the save rebuild leaves a tags row behind when the last note drops a
-- tag) and tags that survive only on soft-deleted notes — so a tag appears here iff
-- at least one live note carries it.
create or replace function list_tags_with_counts()
returns table(name text, count bigint)
language sql
stable
as $$
  select t.name, count(distinct nt.note_id) as count
  from tags t
  join note_tags nt on nt.tag_id = t.id
  join notes n on n.id = nt.note_id and n.deleted_at is null
  group by t.name
  order by t.name;
$$;

-- Notes carrying p_tag OR any descendant (p_tag || '/...'). starts_with (exact prefix,
-- no wildcards) is used instead of LIKE so a tag name containing '_' or '%' can't
-- over-match (e.g. notes_by_tag('client') must not catch 'clientele', and 'a_b' must
-- not catch 'axb'). Case-insensitive to match the lowercase-normalized tag store.
create or replace function notes_by_tag(p_tag text)
returns table(id uuid, title text)
language sql
stable
as $$
  select distinct n.id, n.title
  from notes n
  join note_tags nt on nt.note_id = n.id
  join tags t on t.id = nt.tag_id
  where n.deleted_at is null
    and (t.name = lower(p_tag) or starts_with(t.name, lower(p_tag) || '/'))
  order by n.title;
$$;
