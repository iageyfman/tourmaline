-- Tourmaline — daily-note creation + the shared derived-data rebuild.
--
-- Goal: make "get or create today's daily note" a SINGLE atomic operation so the
-- app-open / Cmd+D path can't leave a half-built note (a date-titled row with
-- is_daily=false) — the state that would wedge every future Cmd+D.
--
-- To avoid duplicating the save pipeline, steps 2-5 of save_note (rebuild links,
-- rebuild tags, claim unresolved, debounced revision + prune) are extracted into
-- rebuild_note_derived(...). save_note becomes a thin wrapper; the new daily RPC
-- calls the SAME helper. Body text is still parsed in TypeScript (parseNote) before
-- either function runs — this layer only does DB writes.

-- One daily note per day. Enforced so the get-or-create select can trust uniqueness
-- and a stray duplicate can't slip in via a race or manual SQL.
create unique index if not exists notes_daily_date_unique
  on notes (daily_date) where is_daily and deleted_at is null;

-- Shared derived-data rebuild: steps 2-5 of the save pipeline, lifted
-- verbatim from 0002 so save_note and get_or_create_daily_note stay in lockstep.
create or replace function rebuild_note_derived(
  v_id     uuid,
  p_title  text,
  p_body   text,
  p_links  jsonb,   -- [{"target_title","is_embed","position"}, ...] in doc order
  p_tags   text[],  -- normalized lowercase, deduped, body + frontmatter merged
  v_is_new boolean
) returns void
language plpgsql
as $$
begin
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
end;
$$;

-- save_note: now step 1 (upsert) + shared rebuild + step 6 (return). Same signature
-- and behavior as 0002 — regression-checked by re-running the S1 + S4 exit tests.
create or replace function save_note(
  p_id         uuid,     -- null = create
  p_title      text,
  p_body       text,     -- already normalized (\n)
  p_folder_id  uuid,
  p_properties jsonb,    -- parsed frontmatter (or {_raw_error,_raw})
  p_links      jsonb,
  p_tags       text[]
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

  perform rebuild_note_derived(v_id, p_title, p_body, p_links, p_tags, v_is_new);

  select * into v_note from notes where id = v_id;
  return to_jsonb(v_note);
end;
$$;

-- get_or_create_daily_note: atomic select-or-insert for the daily note of p_date.
-- Returns {created, collision, note}:
--   created=true                  -> freshly inserted (from the substituted template body)
--   created=false, collision=false-> the existing daily for that date (or a create race we lost)
--   created=false, collision=true -> a NON-daily note already owns this title; left untouched
-- The caller substitutes template vars and parses (parseNote) BEFORE calling this.
create or replace function get_or_create_daily_note(
  p_date       date,
  p_title      text,
  p_body       text,
  p_folder_id  uuid,
  p_properties jsonb,
  p_links      jsonb,
  p_tags       text[]
) returns jsonb
language plpgsql
as $$
declare
  v_id   uuid;
  v_note notes;
begin
  -- 1. already have today's daily? return it untouched (don't re-apply the template).
  select id into v_id
  from notes
  where is_daily and daily_date = p_date and deleted_at is null
  order by created_at
  limit 1;
  if v_id is not null then
    select * into v_note from notes where id = v_id;
    return jsonb_build_object('created', false, 'collision', false, 'note', to_jsonb(v_note));
  end if;

  -- 2. create it — is_daily/daily_date set IN the insert, so there is no half-built window.
  begin
    insert into notes (title, body, folder_id, properties, is_daily, daily_date, updated_at)
    values (p_title, p_body, p_folder_id, coalesce(p_properties, '{}'::jsonb), true, p_date, now())
    returning id into v_id;
  exception when unique_violation then
    -- A title collision (a note already titled like the date) OR a daily_date race.
    select * into v_note from notes
    where lower(title) = lower(p_title) and deleted_at is null
    order by created_at
    limit 1;
    if v_note.id is not null then
      -- collision=true only when the squatter is NOT a daily note (never mutate it).
      return jsonb_build_object('created', false, 'collision', not v_note.is_daily, 'note', to_jsonb(v_note));
    end if;
    -- Title didn't match -> it was the daily_date index (a race with a renamed daily).
    select * into v_note from notes
    where is_daily and daily_date = p_date and deleted_at is null
    order by created_at
    limit 1;
    return jsonb_build_object('created', false, 'collision', false, 'note', to_jsonb(v_note));
  end;

  -- 3. rebuild derived data for the brand-new note (same pipeline as save_note).
  perform rebuild_note_derived(v_id, p_title, p_body, p_links, p_tags, true);

  select * into v_note from notes where id = v_id;
  return jsonb_build_object('created', true, 'collision', false, 'note', to_jsonb(v_note));
end;
$$;
