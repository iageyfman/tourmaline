-- Tourmaline — note composer (merge / extract) + the rename cascade.
--
-- Three atomic plpgsql functions, all returning jsonb, all reusing the canonical
-- rebuild_note_derived(…, v_is_new, /*p_force_revision*/ false) from 0009 — so every
-- touched note gets the same link/tag rebuild + DEBOUNCED revision (we never force a
-- revision here; each touched note's body genuinely changed, so a normal debounced
-- snapshot is right). No new table → no service_role grant; new functions keep PUBLIC
-- EXECUTE. ALL TEXT PARSING stays in TypeScript (lib/pipeline/parse.ts + lib/links/
-- rewrite.ts) — these functions only do the DB writes and are
-- handed pre-parsed link/tag arrays and pre-rewritten bodies.
--
-- The shared p_sources shape (merge + rename): a jsonb array of inbound linker notes
-- whose bodies have ALREADY had [[from]] rewritten to [[to]] (alias/embed preserving) in
-- TS, each {id, title, body, links, tags}. The loop updates each body + re-derives.

-- ── 4.4 merge: fold note A (source) into note B (target), then retire A ───────────────
-- B's p_target_body is computed in TS = B's body + A's content-after-frontmatter, with
-- B's own [[A]]→[[B]] already rewritten. A is SOFT-DELETED FIRST so that, as B and the
-- linkers are rebuilt, every [[B]] resolves to live B and any residual/un-rewritten
-- [[A]] resolves to NULL (honestly unresolved) rather than dangling at a trashed A.
create or replace function merge_notes(
  p_source_id    uuid,
  p_target_id    uuid,
  p_target_title text,
  p_target_body  text,
  p_target_links jsonb,    -- [{"target_title","is_embed","position"}, ...]
  p_target_tags  text[],
  p_sources      jsonb     -- [{id,title,body,links,tags}, ...] inbound linkers (A & B excluded)
) returns jsonb
language plpgsql
as $$
declare
  v_src  notes;
  v_tgt  notes;
  elem   jsonb;
begin
  if p_source_id = p_target_id then
    raise exception 'merge_notes: source equals target';
  end if;

  select * into v_src from notes where id = p_source_id and deleted_at is null;
  if v_src.id is null then
    raise exception 'merge_notes: source % missing or trashed', p_source_id;
  end if;
  select * into v_tgt from notes where id = p_target_id and deleted_at is null;
  if v_tgt.id is null then
    raise exception 'merge_notes: target % missing or trashed', p_target_id;
  end if;

  -- 1. retire A first (soft delete) — resolution below then treats A as gone.
  update notes set deleted_at = now(), updated_at = now() where id = p_source_id;

  -- 2. B gets the appended body (+ its own [[A]]→[[B]]); rebuild its links/tags + revision.
  update notes set body = p_target_body, updated_at = now() where id = p_target_id;
  perform rebuild_note_derived(p_target_id, p_target_title, p_target_body,
                               p_target_links, p_target_tags, false);

  -- 3. every other inbound linker: apply its [[A]]→[[B]] rewritten body + rebuild.
  for elem in select v from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as a(v)
  loop
    update notes set body = elem->>'body', updated_at = now()
     where id = (elem->>'id')::uuid;
    perform rebuild_note_derived(
      (elem->>'id')::uuid,
      elem->>'title',
      elem->>'body',
      coalesce(elem->'links', '[]'::jsonb),
      array(select jsonb_array_elements_text(coalesce(elem->'tags', '[]'::jsonb))),
      false
    );
  end loop;

  select * into v_tgt from notes where id = p_target_id;
  return to_jsonb(v_tgt);
end;
$$;

-- ── 4.4 extract: carve a selection out of the source into a NEW note ──────────────────
-- The caller (TS) has already sliced the source's body (selection → [[New Title]]) and
-- set the new note's body = the selection text, parsing both. Statement order is
-- load-bearing: insert the new note → rebuild it with v_is_new=TRUE (claims any
-- pre-existing unresolved [[New Title]] rows + cuts its first revision) → update the
-- source's body → rebuild the source, whose new [[New Title]] now resolves (left-join)
-- to the just-inserted note WITHIN this transaction. A 23505 on the new title aborts the
-- whole function before the source is touched → caller maps it to duplicate_title.
create or replace function extract_note(
  p_source_id      uuid,
  p_source_title   text,
  p_source_body    text,    -- source body with the selection replaced by [[New Title]]
  p_source_links   jsonb,
  p_source_tags    text[],
  p_new_title      text,
  p_new_body       text,    -- the extracted selection, verbatim
  p_new_links      jsonb,
  p_new_tags       text[],
  p_new_properties jsonb,
  p_new_folder_id  uuid
) returns jsonb
language plpgsql
as $$
declare
  v_new_id uuid;
  v_chk    uuid;
  v_new    notes;
begin
  insert into notes (title, body, folder_id, properties, updated_at)
  values (p_new_title, p_new_body, p_new_folder_id, coalesce(p_new_properties, '{}'::jsonb), now())
  returning id into v_new_id;                 -- may raise 23505 on notes_title_unique

  perform rebuild_note_derived(v_new_id, p_new_title, p_new_body, p_new_links, p_new_tags, true);

  update notes set body = p_source_body, updated_at = now()
   where id = p_source_id and deleted_at is null
   returning id into v_chk;
  if v_chk is null then
    raise exception 'extract_note: source % missing or trashed', p_source_id;
  end if;
  perform rebuild_note_derived(p_source_id, p_source_title, p_source_body,
                               p_source_links, p_source_tags, false);

  select * into v_new from notes where id = v_new_id;
  return to_jsonb(v_new);
end;
$$;

-- ── the rename cascade ─────────────────────────────────────────────────
-- Rename one note and rewrite [[Old]]→[[New]] (alias/embed preserving) across every
-- linking note, transactionally. The note's body is unchanged (the title lives in
-- notes.title, not the body), so properties are untouched and not re-derived; rebuilding
-- self mainly refreshes its own links/tags rows. The title UPDATE may raise 23505 →
-- caller maps duplicate_title (zero writes, single txn). p_sources are the inbound
-- linkers with [[Old]]→[[New]] already rewritten in TS (same shape as merge).
create or replace function rename_note(
  p_id         uuid,
  p_new_title  text,
  p_self_body  text,
  p_self_links jsonb,
  p_self_tags  text[],
  p_sources    jsonb     -- [{id,title,body,links,tags}, ...] inbound linkers
) returns jsonb
language plpgsql
as $$
declare
  v_note notes;
  elem   jsonb;
begin
  update notes set title = p_new_title, updated_at = now()
   where id = p_id and deleted_at is null
   returning * into v_note;                   -- may raise 23505 on notes_title_unique
  if v_note.id is null then
    raise exception 'rename_note: note % missing or trashed', p_id;
  end if;

  perform rebuild_note_derived(p_id, p_new_title, p_self_body, p_self_links, p_self_tags, false);

  for elem in select v from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as a(v)
  loop
    update notes set body = elem->>'body', updated_at = now()
     where id = (elem->>'id')::uuid;
    perform rebuild_note_derived(
      (elem->>'id')::uuid,
      elem->>'title',
      elem->>'body',
      coalesce(elem->'links', '[]'::jsonb),
      array(select jsonb_array_elements_text(coalesce(elem->'tags', '[]'::jsonb))),
      false
    );
  end loop;

  select * into v_note from notes where id = p_id;
  return to_jsonb(v_note);
end;
$$;
