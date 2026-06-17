# tourmaline

A single-user linked-notes app — wiki-links, backlinks, daily notes, tags,
properties, a graph view, and full-text search, built on a Next.js + Postgres
stack.

> [!WARNING]
> **tourmaline has no authentication.** It is designed for one trusted operator and
> a server-side Postgres connection. Run it locally, or put it behind your own
> access control before exposing it — anyone who can reach a public deployment has
> full access to every note. See [SECURITY.md](SECURITY.md).

---

## What It's For

Tourmaline is for keeping a personal knowledge base that stays connected while
you write. Capture notes quickly, connect ideas with wiki-links, recover context
through backlinks/search/graph views, and safely reshape notes as your thinking
changes.

---

## Features

**Writing & navigating**
- Markdown editor (CodeMirror 6, dark theme) with an edit ⇄ preview toggle
- `[[wiki-links]]` with `[[Title|alias]]` support, fuzzy autocomplete on `[[`, and click-to-open (Cmd/Ctrl+click in the editor, or click in preview); clicking an unresolved link creates the note
- Backlinks and outgoing-links panels, plus **unlinked mentions** (other notes that name this one in plain text) with one-click linking
- Quick switcher (fuzzy title search) and folders with a drag-to-organize file tree

**Daily driver**
- Daily notes from a template, filed automatically, with prev/next-day navigation
- Reusable templates with `{{date}}`, `{{time}}`, `{{title}}` variables
- Tags pane (counts + nested `a/b` tree) and an editable frontmatter **properties** table
- Full-text search with ranked snippets and `tag:` / `path:` / `prop:key=value` operators

**Seeing the whole vault**
- Force-directed **graph view** (global and per-note local graph), nodes sized by links and colored by folder
- Note **embeds** — `![[Title]]` renders the target inline
- **Bookmarks** for notes, searches, and headings; per-note **outline** panel

**Database-like power**
- **Database-style views** — filter by tag/folder/property into a sortable table or card grid with inline property editing
- **Version history** — per-note revision browser to view and restore past versions
- **Note composer** — merge one note into another (repointing every inbound link) or extract a selection into a new note, leaving a link behind
- **Rename cascade** — renaming a note rewrites `[[links]]` to it everywhere, transactionally, with aliases preserved

---

## Screenshots

![Tourmaline main workspace](docs/screenshots/workspace.svg)

The main workspace combines folders, recent notes, Markdown editing, backlinks,
outgoing links, properties, and an outline in one view.

![Tourmaline graph and saved views](docs/screenshots/graph-and-views.svg)

Graph view shows how notes connect; saved views turn tags, folders, and
frontmatter properties into sortable working sets.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘/Ctrl + O | Quick switcher |
| ⌘/Ctrl + N | New note |
| ⌘/Ctrl + D | Today's daily note |
| ⌘/Ctrl + E | Toggle edit / preview |
| ⌘/Ctrl + ⇧ + F | Search |
| ⌘/Ctrl + ⇧ + G | Graph view |

---

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Postgres** via `pg` — schema, derived-data functions, and the save pipeline live in SQL migrations
- **Tailwind CSS v4** for styling
- **CodeMirror 6** (via `@uiw/react-codemirror`) for the editor
- **react-force-graph-2d** for the graph
- **react-markdown** + **remark-gfm** for preview rendering

---

## Getting started

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (local, Docker, or a hosted Postgres provider)

### 1. Install
```bash
npm install
```

### 2. Configure environment
Copy [`.env.example`](.env.example) to `.env.local` and fill in your project's values:
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/tourmaline
```
`DATABASE_URL` is **server-only** and must never reach the browser. `.env.local`
is gitignored; keep it that way. If your hosted database requires SSL, also set
`DATABASE_SSL=true`. See [SECURITY.md](SECURITY.md) for the full security model.

### 3. Set up the database
Apply the SQL files in [`db/migrations/`](db/migrations/) **in numerical order**:
```bash
npm run db:migrate
```

### 4. Run
```bash
npm run dev      # dev server at http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

Other scripts: `npm run typecheck` (strict `tsc`) and `npm run exit-test` (the
save-pipeline check — talks to a real database, so point it at a throwaway project).

---

## How it works

Every save runs through one server-side pipeline: it parses the note's frontmatter, `[[links]]`, and `#tags` (never from inside code blocks), then rebuilds the derived `links` and `tags` tables, resolves links by title (claiming previously-unresolved ones), and snapshots a revision. Because parsing lives in exactly one place, every downstream feature — backlinks, graph, search, views, rename cascade — reads consistent data. Note titles are unique (case-insensitive), and deletes are soft (a recoverable trash state).

---

## Scope

Single-user by design. Deliberately **out of scope**: WYSIWYG / live preview, canvas, a plugin system, block-level embeds (`![[note#^block]]`), offline / local-first sync, and multi-user sharing.

---

## Contributing

Bug fixes and docs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). It's a
small project with an intentionally fixed scope, so large feature PRs may be
declined.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
