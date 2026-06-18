# Contributing

Thanks for your interest. This is a small, single-maintainer project with a
deliberately fixed scope, so substantial feature PRs may be declined to keep it
focused — but bug fixes, correctness improvements, and documentation are
genuinely welcome. Opening an issue to discuss before a large change is a good
idea.

## Development setup

See the [README](README.md) for prerequisites, environment variables, and how to
apply the database migrations.

## Before opening a pull request

- `npm run typecheck` — must pass (strict TypeScript, no errors).
- `npm run build` — must succeed.
- If you change anything in the **save pipeline** (`lib/pipeline/`) or the link /
  tag / rename logic, run `npm run exit-test` against your **own throwaway
  Postgres database**. It exercises the parsing and derived-data invariants end to end.
  (It talks to a real database and writes test rows — never point it at data you
  care about.)

## Ground rules

- **Database changes go through migrations.** Add a new, sequentially numbered
  file in `db/migrations/`. Never edit a migration after it has shipped; the
  migrator records checksums and will reject changed migrations.
- **Parsing happens server-side, in one place.** Frontmatter, `[[links]]`, and
  `#tags` are parsed in the save pipeline — not in components. The `links` and
  `tags` tables are derived data, rebuilt on save; don't write to them directly
  from UI code.
- **Mutations are server actions; keep components thin.**
- **Deletes are soft** (set `deleted_at`); don't hard-delete from app code.
- Prefer plain, readable code over clever code.

## Scope

Some things are intentionally **out of scope** and PRs adding them will be
declined: WYSIWYG / live preview, a canvas, a plugin system, block-level embeds
(`![[note#^block]]`), offline / local-first sync, and multi-user support.
