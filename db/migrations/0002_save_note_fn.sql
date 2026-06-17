-- Tourmaline — the save pipeline write path (the canonical save_note function).
--
-- All TEXT PARSING (frontmatter, [[links]], #tags, code-block stripping) happens
-- in TypeScript (lib/pipeline/parse.ts). This function only does the DB WRITES,
-- atomically in one transaction:
--   1. upsert note (+ bump updated_at)
--   2. rebuild links, resolving target_id by live title (case-insensitive)
--   3. rebuild tags / note_tags
--   4. claim unresolved links pointing at this title (on create)
--   5. write a debounced revision (max one per note / 5 min) + prune to last 100
--   6. updated_at handled in step 1
--
-- security invoker (default): the app connects as the DATABASE_URL role.

create or replace function save_note(
  p_id         uuid,     -- null = create
  p_title      text,
  p_body       text,     -- already normalized (\n)
  p_folder_id  uuid,
  p_properties jsonb,    -- parsed frontmatter (or {_raw_error,_raw})
  p_links      jsonb,    -- [{"target_title","is_embed","position"}, ...] in doc order
  p_tags       text[]    -- normalized lowercase, deduped, body + frontmatter merged
) returns jsonb
language plpgsql
as $$
declare
  v_id     uuid;
  v_is_new boolean := false;
  v_note   notes;
begin
  -- 1. upsert note (+ bump updated_at on update)
  if p_id is null then
    insert into notes (title, body, folder_id, properties, updated_at)
    values (p_title, p_body, p_folder_id, coalesce(p_properties, '{}'::jsonb), now())
    returning id into v_id;
    v_is_new := true;
  else
    update notes
       set title      = p_title,
           body       = p_body,
           folder_id  = p_folder_id,
           properties = coalesce(p_properties, '{}'::jsonb),
           updated_at = now()
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'save_note: note % not found', p_id;
    end if;
  end if;

  -- 2. rebuild links: delete then re-insert, resolving target by LIVE title
  delete from links where source_id = v_id;
  insert into links (source_id, target_id, target_title, is_embed, position)
  select v_id,
         n.id,                                    -- null when no live note matches
         elem->>'target_title',
         coalesce((elem->>'is_embed')::boolean, false),
         coalesce((elem->>'position')::int, 0)
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) elem
  left join notes n
         on lower(n.title) = lower(elem->>'target_title')
        and n.deleted_at is null;

  -- 3. tags: ensure-exist (ignore RETURNING), then rebuild note_tags by SELECT-back.
  --    NOTE: `on conflict do nothing ... returning` does NOT return pre-existing
  --    rows, so we must SELECT back by name to cover tags reused across notes.
  if array_length(p_tags, 1) is not null then
    insert into tags (name)
    select distinct t from unnest(p_tags) t
    on conflict (name) do nothing;
  end if;
  delete from note_tags where note_id = v_id;
  insert into note_tags (note_id, tag_id)
  select v_id, tg.id from tags tg where tg.name = any(p_tags);

  -- 4. claim unresolved links pointing at this title (on create)
  if v_is_new then
    update links
       set target_id = v_id
     where target_id is null
       and lower(target_title) = lower(p_title);
  end if;

  -- 5. revision, debounced 5 min (writes #1 on create; 2nd save in window skipped)
  insert into note_revisions (note_id, body, title)
  select v_id, p_body, p_title
  where not exists (
    select 1 from note_revisions
    where note_id = v_id and created_at > now() - interval '5 minutes'
  );
  -- prune to last 100 (runs every save)
  delete from note_revisions
  where note_id = v_id
    and id not in (
      select id from note_revisions
      where note_id = v_id
      order by created_at desc
      limit 100
    );

  -- 6. return the note row
  select * into v_note from notes where id = v_id;
  return to_jsonb(v_note);
end;
$$;
