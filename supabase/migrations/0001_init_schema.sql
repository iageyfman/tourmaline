-- Tourmaline — initial schema: notes, folders, links, tags, and revisions.
-- gen_random_uuid() is built into Postgres 13+, but ensure pgcrypto for portability.
create extension if not exists pgcrypto;

-- Folders: simple adjacency tree
create table folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references folders(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Notes: the core table
create table notes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null default '',
  folder_id   uuid references folders(id) on delete set null,
  properties  jsonb not null default '{}',   -- parsed YAML frontmatter
  is_daily    boolean not null default false, -- daily-note flag
  daily_date  date,                           -- set when is_daily = true
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,                    -- soft delete (trash)
  search_tsv  tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored
);

create unique index notes_title_unique on notes (lower(title)) where deleted_at is null;
create index notes_search_idx on notes using gin (search_tsv);
create index notes_properties_idx on notes using gin (properties);

-- Links: rebuilt on every save from [[...]] in body
create table links (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references notes(id) on delete cascade,
  target_id     uuid references notes(id) on delete cascade,
  target_title  text not null,        -- raw text inside [[ ]]; kept even when resolved
  is_embed      boolean not null default false,  -- true for ![[note]]
  position      int not null default 0           -- order of appearance in body
);

create index links_source_idx on links (source_id);
create index links_target_idx on links (target_id);
create index links_unresolved_idx on links (lower(target_title)) where target_id is null;

-- Tags: rebuilt on save from #tags in body + frontmatter `tags:` key
create table tags (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique          -- stored lowercase, nested via '/' e.g. 'client/toyota'
);

create table note_tags (
  note_id  uuid not null references notes(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (note_id, tag_id)
);

-- Bookmarks: saved notes, searches, headings
create table bookmarks (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('note', 'search', 'heading')),
  note_id     uuid references notes(id) on delete cascade,
  payload     jsonb not null default '{}',  -- search query string, heading anchor, etc.
  label       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Revisions: write-on-save version history
create table note_revisions (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references notes(id) on delete cascade,
  body        text not null,
  title       text not null,
  created_at  timestamptz not null default now()
);

create index note_revisions_note_idx on note_revisions (note_id, created_at desc);
