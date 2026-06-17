"use client";

import { useEffect, useMemo } from "react";
import { Editor } from "./editor";
import { Preview } from "./preview";
import { RightSidebar } from "./right-sidebar";
import { SaveStatePill } from "../save-state-pill";
import { BacklinksPanel } from "./backlinks-panel";
import { UnlinkedMentionsPanel } from "./unlinked-mentions-panel";
import { ComposeMenu } from "./compose-menu";
import { PropertiesPanel } from "./properties-panel";
import { extractHeadings, type Heading } from "@/lib/outline/headings";
import type { SaveState } from "../types";
import type { Backlink } from "@/lib/links/snippets";
import type { UnlinkedMention } from "@/lib/links/mentions";
import type { OutgoingLinks } from "@/lib/links/outgoing";
import type { EmbedTarget } from "./embed-box";
import type { EditorView } from "@uiw/react-codemirror";

export function EditorPane({
  noteId,
  title,
  body,
  mode,
  save,
  titlesRef,
  titles,
  backlinks,
  unlinkedMentions,
  outgoing,
  resolveEmbed,
  onTitleChange,
  onBodyChange,
  onToggleMode,
  onNavigate,
  onOpenNote,
  onLinkMention,
  onOpenHistory,
  onMerge,
  onExtract,
  onCommitTitle,
  onWikiNavigateRef,
  dailyDate,
  onPrevDay,
  onNextDay,
  properties,
  onSetProperty,
  onDeleteProperty,
  editorEpoch,
  onViewReady,
  rightSidebarOpen,
  onToggleRightSidebar,
  isNoteBookmarked,
  onToggleNoteBookmark,
  bookmarkedHeadingSlugs,
  onToggleHeadingBookmark,
  onScrollToHeading,
  pendingHeadingSlug,
  onPendingHeadingConsumed,
}: {
  noteId: string;
  title: string;
  body: string;
  mode: "edit" | "preview";
  save: SaveState;
  titlesRef: { current: string[] };
  titles: Set<string>;
  backlinks: Backlink[];
  unlinkedMentions: UnlinkedMention[];
  outgoing: OutgoingLinks;
  resolveEmbed: (lowerTitle: string) => EmbedTarget | null;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onToggleMode: () => void;
  onNavigate: (title: string) => void;
  onOpenNote: (id: string) => void;
  onLinkMention: (sourceId: string) => void;
  onOpenHistory: () => void;
  onMerge: () => void;
  onExtract: () => void;
  onCommitTitle: () => void;
  onWikiNavigateRef: { current: (title: string) => void };
  dailyDate: string | null;
  onPrevDay: () => void;
  onNextDay: () => void;
  properties: Record<string, unknown>;
  onSetProperty: (key: string, value: unknown) => void;
  onDeleteProperty: (key: string) => void;
  editorEpoch: number;
  onViewReady: (view: EditorView) => void;
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
  isNoteBookmarked: boolean;
  onToggleNoteBookmark: () => void;
  bookmarkedHeadingSlugs: Set<string>;
  onToggleHeadingBookmark: (h: Heading) => void;
  onScrollToHeading: (h: Heading) => void;
  pendingHeadingSlug: string | null;
  onPendingHeadingConsumed: () => void;
}) {
  // One headings scan feeds BOTH the outline and the preview's id assignment (so slug === id).
  const headings = useMemo(() => extractHeadings(body), [body]);

  // A heading bookmark opened this note (cross-note): scroll once the body's headings + the active
  // pane are ready, then clear the pending slug. rAF gives the editor view / preview DOM a frame.
  useEffect(() => {
    if (!pendingHeadingSlug) return;
    const h = headings.find((x) => x.slug === pendingHeadingSlug);
    if (!h) return; // headings for this body not ready yet
    const raf = requestAnimationFrame(() => {
      onScrollToHeading(h);
      onPendingHeadingConsumed();
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingHeadingSlug, headings, noteId, onScrollToHeading, onPendingHeadingConsumed]);

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onCommitTitle}
            onKeyDown={(e) => {
              // Enter commits the rename (blur → onCommitTitle → cascade if the title changed).
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="Untitled"
            className="min-w-0 flex-1 bg-transparent text-lg font-medium outline-none placeholder:text-neutral-600"
          />
          <button
            onClick={onToggleNoteBookmark}
            title={isNoteBookmarked ? "Remove bookmark" : "Bookmark this note"}
            aria-label={isNoteBookmarked ? "Remove note bookmark" : "Bookmark this note"}
            className={`shrink-0 text-lg leading-none ${
              isNoteBookmarked ? "text-amber-400" : "text-neutral-500 hover:text-amber-400"
            }`}
          >
            {isNoteBookmarked ? "★" : "☆"}
          </button>
          {dailyDate && (
            <span className="flex shrink-0 items-center text-neutral-400" title={`Daily note ${dailyDate}`}>
              <button
                title="Previous day"
                onClick={onPrevDay}
                className="rounded px-1.5 py-0.5 text-base leading-none hover:bg-neutral-800"
              >
                ‹
              </button>
              <button
                title="Next day"
                onClick={onNextDay}
                className="rounded px-1.5 py-0.5 text-base leading-none hover:bg-neutral-800"
              >
                ›
              </button>
            </span>
          )}
          <SaveStatePill save={save} />
          <button
            onClick={onToggleMode}
            className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {mode === "edit" ? "Preview" : "Edit"} ⌘E
          </button>
          <ComposeMenu onMerge={onMerge} onExtract={onExtract} />
          <button
            onClick={onOpenHistory}
            title="Version history"
            aria-label="Open version history"
            className="shrink-0 rounded border border-neutral-700 px-1.5 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-sky-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3v5h5" />
              <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
              <path d="M12 7v5l4 2" />
            </svg>
          </button>
          <button
            onClick={onToggleRightSidebar}
            title={rightSidebarOpen ? "Hide outline & links" : "Show outline & links"}
            aria-label="Toggle right sidebar"
            className={`shrink-0 rounded border border-neutral-700 px-1.5 py-1 hover:bg-neutral-800 ${
              rightSidebarOpen ? "text-sky-400" : "text-neutral-400"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="15" y1="4" x2="15" y2="20" />
            </svg>
          </button>
        </div>
        <PropertiesPanel
          noteId={noteId}
          properties={properties}
          onSetProperty={onSetProperty}
          onDeleteProperty={onDeleteProperty}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {mode === "edit" ? (
            <Editor
              key={`${noteId}:${editorEpoch}`}
              initialBody={body}
              onChange={onBodyChange}
              titlesRef={titlesRef}
              onViewReady={onViewReady}
              onWikiNavigateRef={onWikiNavigateRef}
            />
          ) : (
            <Preview
              body={body}
              titles={titles}
              headings={headings}
              resolveEmbed={resolveEmbed}
              onNavigate={onNavigate}
            />
          )}
        </div>
        <BacklinksPanel backlinks={backlinks} onOpenNote={onOpenNote} />
        <UnlinkedMentionsPanel
          mentions={unlinkedMentions}
          onOpenNote={onOpenNote}
          onLink={onLinkMention}
        />
      </div>
      {rightSidebarOpen && (
        <RightSidebar
          headings={headings}
          bookmarkedSlugs={bookmarkedHeadingSlugs}
          outgoing={outgoing}
          onScrollToHeading={onScrollToHeading}
          onToggleHeadingBookmark={onToggleHeadingBookmark}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
