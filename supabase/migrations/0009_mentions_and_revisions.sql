-- Tourmaline — unlinked-mention prefilter + revision restore.
--
-- notes_containing_text(p_note_id) — a coarse, read-only candidate prefilter.
--   Returns every OTHER live note whose body contains the open note's title as a literal
--   case-insensitive substring (strpos = literal substring, so no LIKE-wildcard escaping).
--   This is a strict SUPERSET of true plain-text mentions; the PRECISE detection (mask
--   code, exclude existing [[links]], skip frontmatter, word-boundary) happens in TS
--   (lib/links/mentions.ts). Note parsing stays in TypeScript.
--
-- version history reads the existing note_revisions table (created in 0001, written +
--   pruned by rebuild_note_derived). No new table → no service_role grant. restore_revision
--   applies an old revision's title/body/properties to its note and ALWAYS cuts a new
--   revision (never destroys history). To express "always revision" plainly (not via a
--   debounce-suppression trick), rebuild_note_derived gains an explicit p_force_revision
--   flag (default false → save_note / daily RPC behavior unchanged).
--
-- New functions keep PUBLIC EXECUTE by default; no grants needed.

-- ── 4.2 candidate prefilter ───────────────────────────────────────────────────────────
create or replace function notes_containing_text(p_note_id uuid)
returns table (id uuid, title text, body text)
language sql
stable
as $$
  with self as (
    select n.title from notes n where n.id = p_note_id and n.deleted_at is null
  )
  select c.id, c.title, c.body
  from notes c, self
  where c.id <> p_note_id
    and c.deleted_at is null
    and length(btrim(self.title)) > 0
    and strpos(lower(c.body), lower(self.title)) > 0;
$$;

-- ── rebuild_note_derived: + explicit p_force_revision (default false) ──────────────────
-- Steps 2-4 are IDENTICAL to migration 0004 (links rebuild, tags, claim-unresolved); only
-- step 5's WHERE gains `p_force_revision or …`. Adding a 7th param changes the signature, so
-- the old 6-arg function is dropped first — the existing 6-arg calls in save_note /
-- get_or_create_daily_note then resolve to this 7-arg version with p_force_revision => false
-- (Postgres fills the default), keeping their behavior byte-for-byte. plpgsql resolves nested
-- function calls at runtime, so dropping/recreating doesn't disturb the callers.
drop function if exists rebuild_note_derived(uuid, text, text, jsonb, text[], boolean);

create or replace function rebuild_note_derived(
  v_id     uuid,
  p_title  text,
  p_body   text,
  p_links  jsonb,   -- [{"target_title","is_embed","position"}, ...] in doc order
  p_tags   text[],  -- normalized lowercase, deduped, body + frontmatter merged
  v_is_new boolean,
  p_force_revision boolean default false  -- true on restore: always cut a revision (4.3)
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

  -- 5. revision: forced on restore (4.3 guarantee), else debounced (max one per note / 5 min)
  insert into note_revisions (note_id, body, title)
  select v_id, p_body, p_title
  where p_force_revision or not exists (
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

-- ── 4.3 restore_revision ──────────────────────────────────────────────────────────────
-- Atomic restore of one revision onto its note. Sets title/body/properties (properties is
-- body-derived and MUST be re-derived so the panel / views / prop: search stay consistent);
-- folder_id, is_daily, daily_date are deliberately left untouched (restoring a daily note's
-- old revision keeps it daily). The UPDATE may raise 23505 on notes_title_unique when the old
-- title now collides with another live note; since this is one
-- transaction with no handler, that aborts the whole function → zero writes, and the caller
-- maps 23505 to duplicate_title. Parsing stays in TS: the caller passes pre-parsed
-- p_properties / p_links / p_tags derived from the revision body (the function re-reads the
-- authoritative title/body from the revision row by id).
create or replace function restore_revision(
  p_note_id     uuid,
  p_revision_id uuid,
  p_properties  jsonb,
  p_links       jsonb,
  p_tags        text[]
) returns jsonb
language plpgsql
as $$
declare
  v_rev  note_revisions;
  v_note notes;
begin
  select * into v_rev from note_revisions
   where id = p_revision_id and note_id = p_note_id;
  if v_rev.id is null then
    raise exception 'restore_revision: revision % not found for note %', p_revision_id, p_note_id;
  end if;

  update notes
     set title      = v_rev.title,
         body       = v_rev.body,
         properties = coalesce(p_properties, '{}'::jsonb),
         updated_at = now()
   where id = p_note_id and deleted_at is null
   returning * into v_note;
  if v_note.id is null then
    raise exception 'restore_revision: note % missing or trashed', p_note_id;
  end if;

  -- rebuild links/tags + prune, and FORCE a new revision (the 4.3 guarantee).
  perform rebuild_note_derived(p_note_id, v_rev.title, v_rev.body, p_links, p_tags, false, true);

  return to_jsonb(v_note);
end;
$$;
