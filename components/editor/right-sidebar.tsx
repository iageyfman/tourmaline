"use client";

import { OutlinePanel } from "./outline-panel";
import { OutgoingLinksPanel } from "./outgoing-links-panel";
import type { Heading } from "@/lib/outline/headings";
import type { OutgoingLinks } from "@/lib/links/outgoing";

/**
 * The right sidebar. Hosts the two read-side panels: Outline on top, Outgoing links below —
 * stacked collapsibles, matching the backlinks idiom. Backlinks stays at the bottom of the
 * note view and properties stays above the body; those panels are deliberately not relocated.
 * Toggled from the editor header; app-shell owns the open/closed state so it persists across
 * note switches.
 */
export function RightSidebar({
  headings,
  bookmarkedSlugs,
  outgoing,
  onScrollToHeading,
  onToggleHeadingBookmark,
  onNavigate,
}: {
  headings: Heading[];
  bookmarkedSlugs: Set<string>;
  outgoing: OutgoingLinks;
  onScrollToHeading: (h: Heading) => void;
  onToggleHeadingBookmark: (h: Heading) => void;
  onNavigate: (title: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900/40">
      <OutlinePanel
        headings={headings}
        bookmarkedSlugs={bookmarkedSlugs}
        onScrollToHeading={onScrollToHeading}
        onToggleHeadingBookmark={onToggleHeadingBookmark}
      />
      <OutgoingLinksPanel links={outgoing} onNavigate={onNavigate} />
    </aside>
  );
}
