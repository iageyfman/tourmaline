"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@uiw/react-codemirror";
import { createFolder, renameFolder, deleteFolder, moveNote } from "@/lib/folders/actions";
import { createNote, updateNote, getNote, softDeleteNote, getNoteBodies } from "@/lib/notes/actions";
import { getBacklinks, getOutgoingLinks, getUnlinkedMentions, linkMention } from "@/lib/links/actions";
import { mergeNotes, extractNote, renameNote } from "@/lib/links/composer";
import { extractEmbedTitles } from "@/lib/links/embeds";
import { parseFrontmatter } from "@/lib/pipeline/parse";
import { listRevisions, restoreRevision, type RevisionMeta } from "@/lib/revisions/actions";
import {
  listBookmarks,
  addBookmark,
  removeBookmark,
  reorderBookmarks,
  toggleNoteBookmark,
  toggleHeadingBookmark,
  type Bookmark,
} from "@/lib/bookmarks/actions";
import { getOrCreateDailyNote } from "@/lib/daily/actions";
import { listTemplates, createNoteFromTemplate } from "@/lib/templates/actions";
import { localDateString, localTimeString, addDays } from "@/lib/daily/dates";
import { listTagsWithCounts } from "@/lib/tags/actions";
import { setNoteProperty, deleteNoteProperty } from "@/lib/properties/actions";
import { useShortcuts } from "@/lib/keyboard/registry";
import { createAutosaver } from "@/lib/autosave";
import { FolderTree } from "./explorer/folder-tree";
import { EditorPane } from "./editor/editor-pane";
import { QuickSwitcher } from "./quick-switcher";
import { TemplatePicker, type TemplateItem } from "./template-picker";
import { TagPane } from "./explorer/tag-pane";
import { BookmarksSection } from "./explorer/bookmarks-section";
import { SearchModal } from "./search-modal";
import { GraphModal } from "./graph-modal";
import { HistoryModal } from "./revisions/history-modal";
import { MergePicker } from "./merge-picker";
import { ExtractModal } from "./extract-modal";
import { ViewsTab } from "./views/views-tab";
import { ViewPane } from "./views/view-pane";
import { listViews, createView, updateView, deleteView, runView, type ViewInput } from "@/lib/views/actions";
import type { FolderItem, NoteItem, SaveState } from "./types";
import type { Backlink } from "@/lib/links/snippets";
import type { UnlinkedMention } from "@/lib/links/mentions";
import type { OutgoingLinks } from "@/lib/links/outgoing";
import type { EmbedTarget } from "./editor/embed-box";
import type { Heading } from "@/lib/outline/headings";
import type { View, ViewFilter, ViewRow } from "@/lib/views/types";

interface OpenNote {
  id: string;
  title: string;
  body: string;
  folder_id: string | null;
  is_daily?: boolean;
  daily_date?: string | null;
  properties?: Record<string, unknown>;
}

export function AppShell({
  initialFolders,
  initialNotes,
  initialViews,
}: {
  initialFolders: FolderItem[];
  initialNotes: NoteItem[];
  initialViews: View[];
}) {
  const [folders, setFolders] = useState<FolderItem[]>(initialFolders);
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [unlinkedMentions, setUnlinkedMentions] = useState<UnlinkedMention[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [dailyDate, setDailyDate] = useState<string | null>(null); // open note's daily_date (drives prev/next)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [properties, setProperties] = useState<Record<string, unknown>>({});
  const [editorEpoch, setEditorEpoch] = useState(0); // bumped to remount the editor after a property edit
  const [leftTab, setLeftTab] = useState<"explorer" | "tags" | "views">("explorer");
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState(""); // seeds the box (e.g. tag: re-route)
  const [graphOpen, setGraphOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // version-history modal (4.3)
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]); // open note's revisions, for the modal
  const [mergePickerOpen, setMergePickerOpen] = useState(false); // 4.4 merge: target picker
  const [extractModalOpen, setExtractModalOpen] = useState(false); // 4.4 extract: new-note title prompt
  const [extractCtx, setExtractCtx] = useState<{ text: string; from: number; to: number } | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingLinks>({ resolved: [], unresolved: [] });
  const [embedTargets, setEmbedTargets] = useState<Record<string, EmbedTarget>>({}); // lowercased title → body
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [pendingHeadingSlug, setPendingHeadingSlug] = useState<string | null>(null); // scroll after a heading-bookmark open
  // Views: saved database-style views; the open one renders in <main> instead of the editor.
  const [views, setViews] = useState<View[]>(initialViews);
  const [openViewId, setOpenViewId] = useState<string | null>(null);
  const [viewRows, setViewRows] = useState<ViewRow[]>([]); // result set of the open view
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  // Refs mirror the latest state so the stable autosaver + the memoized editor extensions
  // never read stale values.
  const openNoteIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const bodyRef = useRef("");
  const folderRef = useRef<string | null>(null);
  const titlesRef = useRef<string[]>([]);
  const didInit = useRef(false); // "app opens to today" fires once (guards StrictMode double-mount)
  const editorViewRef = useRef<EditorView | null>(null); // set via Editor.onViewReady; for edit-mode outline scroll
  const viewRunSeq = useRef(0); // race-guards runView fetches (latest result wins)
  const titleAtOpenRef = useRef(""); // pre-edit title baseline → drives the rename cascade (4.4)
  const onWikiNavigateRef = useRef<(title: string) => void>(() => {}); // edit-mode Cmd+click → navigate
  openNoteIdRef.current = openNoteId;
  titleRef.current = title;
  bodyRef.current = body;
  folderRef.current = openFolderId;
  titlesRef.current = notes.map((n) => n.title);
  onWikiNavigateRef.current = (t: string) => void onWikiNavigate(t);

  // Lowercased title set drives resolved/unresolved styling for wiki-links in the preview.
  const titleSet = useMemo(() => new Set(notes.map((n) => n.title.toLowerCase())), [notes]);

  // Backlinks refresh whenever the open note changes (covers open-existing AND create-then-
  // open). Race-guarded so a slow fetch for a previous note can't clobber the current one.
  useEffect(() => {
    if (!openNoteId) {
      setBacklinks([]);
      setUnlinkedMentions([]);
      setOutgoing({ resolved: [], unresolved: [] });
      return;
    }
    let ignore = false;
    Promise.all([getBacklinks(openNoteId), getOutgoingLinks(openNoteId), getUnlinkedMentions(openNoteId)])
      .then(([bl, out, um]) => {
        if (ignore) return;
        setBacklinks(bl);
        setOutgoing(out);
        setUnlinkedMentions(um);
      })
      .catch(() => {
        if (ignore) return;
        setBacklinks([]);
        setOutgoing({ resolved: [], unresolved: [] });
        setUnlinkedMentions([]);
      });
    return () => {
      ignore = true;
    };
  }, [openNoteId]);

  // Embeds (3.3): resolve `![[Title]]` targets against the LIVE body, but only in preview — the
  // body can't change while preview is shown, so [openNoteId, mode] is enough (no per-keystroke
  // refetch). Map titles→ids via the in-memory note list (sidesteps lower(title) case matching),
  // then fetch bodies by id. Race-guarded.
  useEffect(() => {
    if (!openNoteId || mode !== "preview") return;
    const wanted = extractEmbedTitles(bodyRef.current);
    if (wanted.length === 0) {
      setEmbedTargets({});
      return;
    }
    const idByTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
    const ids = wanted.map((t) => idByTitle.get(t)).filter((x): x is string => !!x);
    let ignore = false;
    getNoteBodies(ids)
      .then((rows) => {
        if (ignore) return;
        const map: Record<string, EmbedTarget> = {};
        for (const r of rows) map[r.title.toLowerCase()] = { title: r.title, body: r.body };
        setEmbedTargets(map);
      })
      .catch(() => {
        if (!ignore) setEmbedTargets({});
      });
    return () => {
      ignore = true;
    };
  }, [openNoteId, mode, notes]);

  // Bookmarks (3.4): load once on mount; refreshed after any add/remove/reorder/toggle.
  useEffect(() => {
    listBookmarks()
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
  }, []);

  const autosaver = useRef(
    createAutosaver<{ id: string; title: string; body: string; folderId: string | null }>({
      delayMs: 1000,
      save: async (p) => {
        const res = await updateNote({ id: p.id, title: p.title, body: p.body, folderId: p.folderId });
        if (!res.ok) {
          setSave({
            status: "error",
            message: res.error === "duplicate_title" ? "Title already exists" : res.message,
          });
          return;
        }
        const savedTitle = (res.note.title as string) ?? p.title;
        setNotes((prev) => prev.map((n) => (n.id === p.id ? { ...n, title: savedTitle } : n)));
        // Keep the properties panel live when frontmatter is edited as raw text in the editor.
        if (openNoteIdRef.current === p.id) setProperties((res.note.properties as Record<string, unknown>) ?? {});
        setSave({ status: "saved" });
      },
    }),
  ).current;

  function scheduleSave(next: { title?: string; body?: string }) {
    const id = openNoteIdRef.current;
    if (!id) return;
    setSave({ status: "saving" });
    autosaver.schedule({
      id,
      title: next.title ?? titleRef.current,
      body: next.body ?? bodyRef.current,
      folderId: folderRef.current,
    });
  }

  function onTitleChange(v: string) {
    setTitle(v);
    scheduleSave({ title: v });
  }
  function onBodyChange(v: string) {
    setBody(v);
    scheduleSave({ body: v });
  }

  // Push a freshly-created note into client state and open it in the editor.
  function adoptAndOpen(note: OpenNote) {
    setNotes((prev) =>
      prev.some((n) => n.id === note.id)
        ? prev
        : [...prev, { id: note.id, title: note.title, folder_id: note.folder_id }],
    );
    setOpenNoteId(note.id);
    setOpenViewId(null); // a note takes over the center pane from any open view
    setTitle(note.title);
    titleAtOpenRef.current = note.title; // rename-cascade baseline
    setBody(note.body ?? "");
    setOpenFolderId(note.folder_id);
    setDailyDate(note.is_daily ? note.daily_date ?? null : null);
    setProperties(note.properties ?? {});
    setMode("edit");
    setSave({ status: "idle" });
  }

  async function openNote(id: string) {
    await autosaver.flush(); // persist pending edits to the previously-open note first
    const note = (await getNote(id)) as OpenNote;
    setOpenNoteId(note.id);
    setOpenViewId(null); // a note takes over the center pane from any open view
    setTitle(note.title);
    titleAtOpenRef.current = note.title; // rename-cascade baseline
    setBody(note.body);
    setOpenFolderId(note.folder_id);
    setDailyDate(note.is_daily ? note.daily_date ?? null : null);
    setProperties(note.properties ?? {});
    setMode("edit");
    setSave({ status: "idle" });
  }

  async function newNote(folderId: string | null) {
    await autosaver.flush();
    const res = await createNote({ folderId });
    if (!res.ok) {
      setSave({ status: "error", message: res.message });
      return;
    }
    adoptAndOpen(res.note as unknown as OpenNote);
  }

  // Click a [[wiki link]] (preview) or Shift+Enter (switcher): open the target, or create + open when missing.
  async function onWikiNavigate(linkTitle: string) {
    const existing = notes.find((n) => n.title.toLowerCase() === linkTitle.toLowerCase());
    if (existing) {
      await openNote(existing.id);
      return;
    }
    await autosaver.flush();
    const res = await createNote({ title: linkTitle });
    if (!res.ok) {
      setSave({
        status: "error",
        message: res.error === "duplicate_title" ? "Title already exists" : res.message,
      });
      return;
    }
    adoptAndOpen(res.note as unknown as OpenNote);
  }

  // Daily notes (2.1): one funnel for app-open, Cmd+D, and prev/next. Date is computed
  // client-side (local TZ) and passed down — the server never derives "today".
  async function goToDaily(date: string) {
    await autosaver.flush();
    const res = await getOrCreateDailyNote({ date, time: localTimeString(new Date()) });
    if (!res.ok) {
      // A non-daily note already owns this date's title — open it and surface why.
      adoptAndOpen(res.note as unknown as OpenNote);
      setSave({ status: "error", message: res.message });
      return;
    }
    if (res.folder) {
      setFolders((prev) =>
        prev.some((f) => f.id === res.folder!.id) ? prev : [...prev, res.folder as FolderItem],
      );
    }
    adoptAndOpen(res.note as unknown as OpenNote);
  }

  // Templates (2.2): open the picker with a fresh list; instances land unfiled.
  async function openTemplatePicker() {
    setTemplates(await listTemplates());
    setTemplatePickerOpen(true);
  }

  async function createFromTemplate(
    templateId: string,
    noteTitle: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    await autosaver.flush();
    const now = new Date();
    const res = await createNoteFromTemplate({
      templateId,
      title: noteTitle,
      date: localDateString(now),
      time: localTimeString(now),
    });
    if (!res.ok) return { ok: false, message: res.message };
    adoptAndOpen(res.note as unknown as OpenNote);
    return { ok: true };
  }

  // Properties (2.4): an edit rewrites the body's frontmatter server-side, then re-saves.
  // Flush any pending body autosave FIRST so it can't clobber the rewrite; re-check the open
  // note after the await; remount the editor so its captured body shows the new frontmatter.
  async function applyProperty(
    id: string,
    action: () => Promise<{ ok: true; note: Record<string, unknown> } | { ok: false; error: string; message: string }>,
  ) {
    await autosaver.flush();
    setSave({ status: "saving" });
    const res = await action();
    if (openNoteIdRef.current !== id) return; // navigated away mid-flight
    if (!res.ok) {
      setSave({ status: "error", message: res.message });
      return;
    }
    setBody(res.note.body as string);
    setProperties((res.note.properties as Record<string, unknown>) ?? {});
    setEditorEpoch((e) => e + 1);
    setSave({ status: "saved" });
  }
  function onSetProperty(key: string, value: unknown) {
    const id = openNoteIdRef.current;
    if (id) void applyProperty(id, () => setNoteProperty(id, key, value));
  }
  function onDeleteProperty(key: string) {
    const id = openNoteIdRef.current;
    if (id) void applyProperty(id, () => deleteNoteProperty(id, key));
  }

  // Unlinked mentions (4.2): "Link" rewrites every plain occurrence of THIS note's title in the
  // source note to [[Title]] (server-side, via the pipeline). Flush first so a pending rename is
  // persisted before the new link resolves; then the mention leaves this panel and joins backlinks.
  async function onLinkMention(sourceId: string) {
    const id = openNoteIdRef.current;
    if (!id) return;
    const targetTitle = titleRef.current;
    await autosaver.flush();
    const res = await linkMention(sourceId, targetTitle);
    if (openNoteIdRef.current !== id) return;
    if (!res.ok) {
      setSave({ status: "error", message: res.message });
      return;
    }
    void Promise.all([getBacklinks(id), getUnlinkedMentions(id)])
      .then(([bl, um]) => {
        if (openNoteIdRef.current !== id) return;
        setBacklinks(bl);
        setUnlinkedMentions(um);
      })
      .catch(() => {});
  }

  // Version history (4.3): flush (so the current state is saved and the list is truthful), load the
  // revision list, open the modal.
  async function openHistory() {
    const id = openNoteIdRef.current;
    if (!id) return;
    await autosaver.flush();
    if (openNoteIdRef.current !== id) return;
    try {
      setRevisions(await listRevisions(id));
    } catch {
      setRevisions([]);
    }
    setHistoryOpen(true);
  }

  // Restore a revision: mirror applyProperty (flush → mutate → adopt title/body/properties →
  // remount editor). Restore writes a NEW revision (history preserved); a title collision surfaces.
  async function restoreRevisionById(revisionId: string) {
    const id = openNoteIdRef.current;
    if (!id) return;
    await autosaver.flush();
    setSave({ status: "saving" });
    const res = await restoreRevision(id, revisionId);
    if (openNoteIdRef.current !== id) return;
    if (!res.ok) {
      setSave({
        status: "error",
        message: res.error === "duplicate_title" ? "Title already exists" : res.message,
      });
      return; // keep the modal open so the failure is visible
    }
    const note = res.note;
    const newTitle = (note.title as string) ?? titleRef.current;
    setTitle(newTitle);
    setBody(note.body as string);
    setProperties((note.properties as Record<string, unknown>) ?? {});
    setEditorEpoch((e) => e + 1);
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title: newTitle } : n)));
    setSave({ status: "saved" });
    setHistoryOpen(false);
    void Promise.all([getBacklinks(id), getOutgoingLinks(id), getUnlinkedMentions(id)])
      .then(([bl, out, um]) => {
        if (openNoteIdRef.current !== id) return;
        setBacklinks(bl);
        setOutgoing(out);
        setUnlinkedMentions(um);
      })
      .catch(() => {});
  }

  // Note composer (4.4) — merge. The OPEN note (A) is folded into the picked target (B): A's
  // content is appended to B, inbound [[A]]→[[B]] across all linkers, A soft-deleted. Flush
  // first so A's latest body is merged; then drop A from the tree and open B.
  async function mergeOpenInto(targetId: string) {
    const sourceId = openNoteIdRef.current;
    if (!sourceId) return;
    await autosaver.flush();
    setSave({ status: "saving" });
    const res = await mergeNotes(sourceId, targetId);
    if (!res.ok) {
      setSave({ status: "error", message: res.message });
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== sourceId)); // A is trashed
    adoptAndOpen(res.note as unknown as OpenNote); // navigate to B (with the appended content)
  }

  // Note composer (4.4) — extract step 1: capture the editor selection, open the title prompt.
  // Edit-mode only; the selection must be non-empty and below the frontmatter.
  function openExtract() {
    const view = editorViewRef.current;
    if (!openNoteIdRef.current || mode !== "edit" || !view) {
      setSave({ status: "error", message: "Switch to edit mode to extract a selection." });
      return;
    }
    const { from, to } = view.state.selection.main;
    if (from === to) {
      setSave({ status: "error", message: "Select some text to extract first." });
      return;
    }
    if (from < parseFrontmatter(bodyRef.current).contentStart) {
      setSave({ status: "error", message: "Select body text only (not the frontmatter)." });
      return;
    }
    setExtractCtx({ text: view.state.sliceDoc(from, to), from, to });
    setExtractModalOpen(true);
  }

  // Note composer (4.4) — extract step 2: create the new note from the selection and replace the
  // selection in the source with [[New Title]] (one atomic RPC). The client slices its OWN body
  // (the exact text the offsets index) so offsets never reach SQL. On success, open the new note.
  async function extractSelection(newTitle: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const sourceId = openNoteIdRef.current;
    const ctx = extractCtx;
    if (!sourceId || !ctx) return { ok: false, message: "Nothing to extract." };
    await autosaver.flush();
    const src = bodyRef.current;
    const sourceNewBody = src.slice(0, ctx.from) + "[[" + newTitle.trim() + "]]" + src.slice(ctx.to);
    const res = await extractNote({ sourceId, sourceNewBody, newBody: ctx.text, newTitle });
    if (!res.ok) {
      return {
        ok: false,
        message: res.error === "duplicate_title" ? "A note with that title already exists." : res.message,
      };
    }
    setExtractCtx(null);
    adoptAndOpen(res.note as unknown as OpenNote); // open the new note to flesh it out
    return { ok: true };
  }

  // Rename cascade — fired on title blur/Enter. Per-keystroke autosave already
  // set the new title (no cascade); here we rewrite [[Old]]→[[New]] across every linker,
  // transactionally. Old title = the pre-edit baseline (the DB no longer knows it). A title
  // collision reverts the input. Body is unchanged → no editor remount needed.
  async function commitRename() {
    const id = openNoteIdRef.current;
    if (!id) return;
    const committed = titleRef.current.trim();
    const oldTitle = titleAtOpenRef.current;
    if (!committed || committed === oldTitle) return;
    await autosaver.flush();
    if (openNoteIdRef.current !== id) return;
    setSave({ status: "saving" });
    const res = await renameNote(id, oldTitle, committed);
    if (openNoteIdRef.current !== id) return;
    if (!res.ok) {
      setTitle(oldTitle); // the rename didn't happen — restore the last good title
      setSave({
        status: "error",
        message: res.error === "duplicate_title" ? "Title already exists" : res.message,
      });
      return;
    }
    const newTitle = (res.note.title as string) ?? committed;
    setTitle(newTitle);
    titleAtOpenRef.current = newTitle;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title: newTitle } : n)));
    setSave({ status: "saved" });
    void Promise.all([getBacklinks(id), getOutgoingLinks(id), getUnlinkedMentions(id)])
      .then(([bl, out, um]) => {
        if (openNoteIdRef.current !== id) return;
        setBacklinks(bl);
        setOutgoing(out);
        setUnlinkedMentions(um);
      })
      .catch(() => {});
  }

  // Tags (2.3): the pane fetches fresh on activation; a just-typed #tag is rebuilt on save,
  // so flush first. A tag click lists matching notes (incl. descendants) in a modal.
  async function selectTagsTab() {
    setLeftTab("tags");
    await autosaver.flush();
    setTags(await listTagsWithCounts());
  }
  function onTagClick(name: string) {
    // 2.3 "click = filtered search": route through the unified search (2.5) as a tag: query.
    setSearchInitialQuery("tag:" + name);
    setSearchOpen(true);
  }

  async function moveNoteTo(noteId: string, folderId: string | null) {
    await moveNote(noteId, folderId);
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, folder_id: folderId } : n)));
    if (openNoteIdRef.current === noteId) setOpenFolderId(folderId);
  }

  async function deleteNote(id: string) {
    await softDeleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (openNoteIdRef.current === id) {
      setOpenNoteId(null);
      setTitle("");
      setBody("");
      setOpenFolderId(null);
      setDailyDate(null);
      setProperties({});
      setSave({ status: "idle" });
    }
  }

  async function newFolder(parentId: string | null) {
    const name = window.prompt("New folder name:")?.trim();
    if (!name) return;
    try {
      const f = await createFolder({ name, parentId });
      setFolders((prev) => [...prev, f]);
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  async function renameFolderById(id: string, current: string) {
    const name = window.prompt("Rename folder:", current)?.trim();
    if (!name || name === current) return;
    try {
      const f = await renameFolder(id, name);
      setFolders((prev) => prev.map((x) => (x.id === id ? f : x)));
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  async function removeFolder(id: string) {
    try {
      await deleteFolder(id);
      setFolders((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      window.alert((e as Error).message); // e.g. "Folder isn't empty — move or delete its contents first."
    }
  }

  function toggleMode() {
    setMode((m) => (m === "edit" ? "preview" : "edit"));
  }

  // ── Bookmarks (3.4) ──────────────────────────────────────────────────────────────
  async function refreshBookmarks() {
    try {
      setBookmarks(await listBookmarks());
    } catch {
      /* keep current list on a transient read error */
    }
  }

  // Click a bookmark: dispatch by kind. heading → open the note, then scroll once it's mounted.
  function openBookmark(b: Bookmark) {
    if (b.kind === "note" && b.note_id) {
      void openNote(b.note_id);
    } else if (b.kind === "search") {
      setSearchInitialQuery(String((b.payload as { query?: unknown })?.query ?? ""));
      setSearchOpen(true);
    } else if (b.kind === "heading" && b.note_id) {
      const slug = String((b.payload as { slug?: unknown })?.slug ?? "");
      void (async () => {
        await openNote(b.note_id as string);
        if (slug) setPendingHeadingSlug(slug);
      })();
    }
  }

  function removeBookmarkById(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id)); // optimistic
    void removeBookmark(id).then((res) => {
      if (!res.ok) void refreshBookmarks();
    });
  }

  function reorderBookmarksTo(orderedIds: string[]) {
    setBookmarks((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      return orderedIds.map((id) => byId.get(id)).filter((b): b is Bookmark => !!b);
    });
    void reorderBookmarks(orderedIds).then((res) => {
      if (!res.ok) void refreshBookmarks();
    });
  }

  function toggleOpenNoteBookmark() {
    const id = openNoteIdRef.current;
    if (!id) return;
    void toggleNoteBookmark(id, titleRef.current || "Untitled").then((res) => {
      if (res.ok) void refreshBookmarks();
    });
  }

  function toggleHeadingBookmarkForOpen(h: Heading) {
    const id = openNoteIdRef.current;
    if (!id) return;
    void toggleHeadingBookmark({ noteId: id, slug: h.slug, text: h.text, noteTitle: titleRef.current }).then(
      (res) => {
        if (res.ok) void refreshBookmarks();
      },
    );
  }

  async function bookmarkSearch(query: string) {
    if (!query.trim()) return;
    const res = await addBookmark({ kind: "search", payload: { query }, label: query });
    if (res.ok) void refreshBookmarks();
  }

  // ── Views (4.1) ─────────────────────────────────────────────────────────────────────
  const openView = views.find((v) => v.id === openViewId) ?? null;

  async function refreshViews() {
    try {
      setViews(await listViews());
    } catch {
      /* keep current list on a transient read error */
    }
  }

  // Fetch the rows matching a filter (race-guarded: only the latest run's result is applied).
  async function runOpenView(filter: ViewFilter) {
    const seq = ++viewRunSeq.current;
    setViewLoading(true);
    try {
      const rows = await runView(filter);
      if (viewRunSeq.current === seq) setViewRows(rows);
    } catch (e) {
      if (viewRunSeq.current === seq) {
        setViewRows([]);
        setViewError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (viewRunSeq.current === seq) setViewLoading(false);
    }
  }

  async function openViewById(id: string) {
    await autosaver.flush(); // persist any pending body edit before the editor unmounts
    const v = views.find((x) => x.id === id);
    setOpenViewId(id);
    setViewError(null);
    if (v) void runOpenView(v.filter);
  }

  async function newView() {
    await autosaver.flush();
    const res = await createView({
      name: "New view",
      filter: { tag: null, path: null, props: [] },
      columns: [],
      sort: { key: "title", dir: "asc" },
      layout: "table",
    });
    if (!res.ok) {
      setViewError(res.message);
      return;
    }
    setViews((prev) => [...prev, res.view]);
    setLeftTab("views");
    setOpenViewId(res.view.id);
    setViewError(null);
    void runOpenView(res.view.filter);
  }

  // Optimistic definition edit (name / columns / sort / layout / filter), persisted in the
  // background; on success adopt the authoritative row, on failure surface + refetch.
  function updateViewById(id: string, patch: Partial<ViewInput>) {
    setViews((prev) => prev.map((v) => (v.id === id ? ({ ...v, ...patch } as View) : v)));
    void updateView(id, patch).then((res) => {
      if (!res.ok) {
        setViewError(res.message);
        void refreshViews();
      } else {
        setViews((prev) => prev.map((v) => (v.id === id ? res.view : v)));
      }
    });
  }

  // A filter change both persists and re-runs the query (columns/sort/layout are client-side).
  function applyViewFilter(id: string, filter: ViewFilter) {
    updateViewById(id, { filter });
    void runOpenView(filter);
  }

  function deleteViewById(id: string) {
    setViews((prev) => prev.filter((v) => v.id !== id)); // optimistic
    if (openViewId === id) {
      setOpenViewId(null);
      setViewRows([]);
    }
    void deleteView(id).then((res) => {
      if (!res.ok) void refreshViews();
    });
  }

  // Inline property edit from a view cell → the existing property pipeline (re-derives
  // notes.properties), then patch the row in place. ViewPane re-sorts on render; we do NOT
  // re-filter (reopening the view re-fetches).
  function setViewCellProperty(noteId: string, key: string, value: unknown) {
    setViewError(null);
    void setNoteProperty(noteId, key, value).then((res) => {
      if (!res.ok) {
        setViewError(
          res.error === "invalid_yaml"
            ? "That note's frontmatter is invalid — fix it in the editor."
            : res.message,
        );
        return;
      }
      const props = (res.note.properties as Record<string, unknown>) ?? {};
      setViewRows((prev) => prev.map((r) => (r.id === noteId ? { ...r, properties: props } : r)));
      if (openNoteIdRef.current === noteId) setProperties(props);
    });
  }

  // Outline (3.5): scroll the active pane to a heading — preview by element id, edit by line.
  const onScrollToHeading = useCallback(
    (h: Heading) => {
      if (mode === "edit") {
        const view = editorViewRef.current;
        if (!view) return;
        const line = view.state.doc.line(Math.min(h.line + 1, view.state.doc.lines));
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start" }),
        });
        view.focus();
      } else {
        document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [mode],
  );

  const resolveEmbed = useCallback(
    (lowerTitle: string): EmbedTarget | null => embedTargets[lowerTitle] ?? null,
    [embedTargets],
  );

  const isNoteBookmarked = bookmarks.some((b) => b.kind === "note" && b.note_id === openNoteId);
  const bookmarkedHeadingSlugs = useMemo(
    () =>
      new Set(
        bookmarks
          .filter((b) => b.kind === "heading" && b.note_id === openNoteId)
          .map((b) => String((b.payload as { slug?: unknown })?.slug ?? "")),
      ),
    [bookmarks, openNoteId],
  );

  // App-open opens today's daily note. Runs once; the atomic RPC keeps it
  // idempotent even if it double-fires (StrictMode / fast refresh).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (!openNoteIdRef.current) void goToDaily(localDateString(new Date()));
  }, []);

  useShortcuts(
    {
      toggleMode,
      newNote: () => void newNote(folderRef.current),
      openSwitcher: () => setSwitcherOpen(true),
      dailyNote: () => void goToDaily(localDateString(new Date())),
      openSearch: () => {
        setSearchInitialQuery("");
        setSearchOpen(true);
      },
      openGraph: () => setGraphOpen(true),
    },
    switcherOpen ||
      templatePickerOpen ||
      searchOpen ||
      graphOpen ||
      historyOpen ||
      mergePickerOpen ||
      extractModalOpen,
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
        <BookmarksSection
          bookmarks={bookmarks}
          onOpen={openBookmark}
          onReorder={reorderBookmarksTo}
          onRemove={removeBookmarkById}
        />
        <div className="flex shrink-0 border-b border-neutral-800">
          {(["explorer", "tags", "views"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                if (tab === "tags") void selectTagsTab();
                else setLeftTab(tab);
              }}
              className={`min-w-0 flex-1 truncate px-2 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                leftTab === tab
                  ? "border-b-2 border-sky-500 text-neutral-200"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab}
            </button>
          ))}
          <button
            onClick={() => setGraphOpen(true)}
            title="Graph view (⌘⇧G)"
            aria-label="Open graph view"
            className="flex shrink-0 items-center px-3 text-neutral-500 hover:text-sky-400"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="6" x2="18" y2="6" />
              <line x1="5" y1="6" x2="12" y2="18" />
              <line x1="18" y1="6" x2="12" y2="18" />
              <circle cx="5" cy="6" r="2.6" />
              <circle cx="18" cy="6" r="2.6" />
              <circle cx="12" cy="18" r="2.6" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {leftTab === "explorer" ? (
            <FolderTree
              folders={folders}
              notes={notes}
              openNoteId={openNoteId}
              onOpenNote={openNote}
              onNewNote={newNote}
              onNewFolder={newFolder}
              onRenameFolder={renameFolderById}
              onDeleteFolder={removeFolder}
              onDeleteNote={deleteNote}
              onMoveNote={moveNoteTo}
              onNewFromTemplate={() => void openTemplatePicker()}
            />
          ) : leftTab === "tags" ? (
            <TagPane tags={tags} onTagClick={onTagClick} />
          ) : (
            <ViewsTab
              views={views}
              openViewId={openViewId}
              onOpenView={(id) => void openViewById(id)}
              onNewView={() => void newView()}
              onDeleteView={deleteViewById}
            />
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1">
        {openView ? (
          <ViewPane
            key={openView.id}
            view={openView}
            rows={viewRows}
            loading={viewLoading}
            error={viewError}
            folders={folders}
            onUpdateView={(patch) => updateViewById(openView.id, patch)}
            onApplyFilter={(f) => applyViewFilter(openView.id, f)}
            onOpenNote={(id) => void openNote(id)}
            onSetCellProperty={setViewCellProperty}
          />
        ) : openNoteId ? (
          <EditorPane
            noteId={openNoteId}
            title={title}
            body={body}
            mode={mode}
            save={save}
            titlesRef={titlesRef}
            titles={titleSet}
            backlinks={backlinks}
            unlinkedMentions={unlinkedMentions}
            outgoing={outgoing}
            resolveEmbed={resolveEmbed}
            onTitleChange={onTitleChange}
            onBodyChange={onBodyChange}
            onToggleMode={toggleMode}
            onNavigate={onWikiNavigate}
            onOpenNote={openNote}
            onLinkMention={(sourceId) => void onLinkMention(sourceId)}
            onOpenHistory={() => void openHistory()}
            onMerge={() => setMergePickerOpen(true)}
            onExtract={openExtract}
            onCommitTitle={() => void commitRename()}
            onWikiNavigateRef={onWikiNavigateRef}
            dailyDate={dailyDate}
            onPrevDay={() => dailyDate && void goToDaily(addDays(dailyDate, -1))}
            onNextDay={() => dailyDate && void goToDaily(addDays(dailyDate, 1))}
            properties={properties}
            onSetProperty={onSetProperty}
            onDeleteProperty={onDeleteProperty}
            editorEpoch={editorEpoch}
            onViewReady={(view) => {
              editorViewRef.current = view;
            }}
            rightSidebarOpen={rightSidebarOpen}
            onToggleRightSidebar={() => setRightSidebarOpen((v) => !v)}
            isNoteBookmarked={isNoteBookmarked}
            onToggleNoteBookmark={toggleOpenNoteBookmark}
            bookmarkedHeadingSlugs={bookmarkedHeadingSlugs}
            onToggleHeadingBookmark={toggleHeadingBookmarkForOpen}
            onScrollToHeading={onScrollToHeading}
            pendingHeadingSlug={pendingHeadingSlug}
            onPendingHeadingConsumed={() => setPendingHeadingSlug(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Select a note, create one with ＋ note (⌘N), or search with ⌘O.
          </div>
        )}
      </main>

      {switcherOpen && (
        <QuickSwitcher
          notes={notes}
          onOpenNote={openNote}
          onCreateOrOpen={onWikiNavigate}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      {templatePickerOpen && (
        <TemplatePicker
          templates={templates}
          onCreate={createFromTemplate}
          onClose={() => setTemplatePickerOpen(false)}
        />
      )}

      {searchOpen && (
        <SearchModal
          initialQuery={searchInitialQuery}
          folders={folders}
          onOpenNote={openNote}
          onClose={() => setSearchOpen(false)}
          onBookmarkSearch={bookmarkSearch}
        />
      )}

      {graphOpen && (
        <GraphModal
          centerNoteId={openNoteId}
          folders={folders}
          onOpenNote={openNote}
          onClose={() => setGraphOpen(false)}
        />
      )}

      {historyOpen && (
        <HistoryModal
          revisions={revisions}
          currentTitle={title}
          onRestore={(revisionId) => void restoreRevisionById(revisionId)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {mergePickerOpen && openNoteId && (
        <MergePicker
          notes={notes}
          sourceId={openNoteId}
          sourceTitle={title}
          onConfirm={(targetId) => void mergeOpenInto(targetId)}
          onClose={() => setMergePickerOpen(false)}
        />
      )}

      {extractModalOpen && extractCtx && (
        <ExtractModal
          selectionLength={extractCtx.text.length}
          onCreate={extractSelection}
          onClose={() => {
            setExtractModalOpen(false);
            setExtractCtx(null);
          }}
        />
      )}
    </div>
  );
}
