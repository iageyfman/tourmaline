"use client";

import { useMemo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkWikiLink } from "@/lib/markdown/remark-wiki-link";
import { remarkNoteEmbed } from "@/lib/markdown/remark-note-embed";
import { rehypeHeadingSlugs } from "@/lib/outline/rehype-heading-slugs";
import { EmbedBox, type EmbedTarget } from "./embed-box";
import { wikiAnchor, wikiUrlTransform } from "./wiki-anchor";
import type { Heading } from "@/lib/outline/headings";

const REMARK_PLUGINS = [remarkGfm, remarkWikiLink, remarkNoteEmbed];

/**
 * Read-only markdown preview. `[[wiki links]]` → clickable links (1.5); an `![[embed]]` alone on
 * its line → a framed inline note embed (3.3); top-level headings get slug ids (via a rehype
 * transform that consumes the SAME `extractHeadings()` slug list the outline uses) so the outline
 * (3.5) can scroll to them. #tags still render as plain text.
 */
export function Preview({
  body,
  titles,
  headings,
  resolveEmbed,
  onNavigate,
}: {
  body: string;
  titles: Set<string>;
  headings: Heading[];
  resolveEmbed: (lowerTitle: string) => EmbedTarget | null;
  onNavigate: (title: string) => void;
}) {
  // Heading ids are assigned at transform time from the outline's own slugs (occurrence order),
  // so id === outline slug. Memoized on `headings` to avoid churning the markdown processor.
  const rehypePlugins = useMemo(
    () =>
      [[rehypeHeadingSlugs, headings.map((h) => h.slug)]] as ComponentProps<
        typeof ReactMarkdown
      >["rehypePlugins"],
    [headings],
  );

  const components = useMemo(
    () =>
      ({
        a: wikiAnchor(titles, onNavigate),
        "note-embed": ({ title }: { title?: string }) => (
          <EmbedBox title={title ?? ""} resolve={resolveEmbed} titles={titles} onNavigate={onNavigate} />
        ),
      }) as unknown as Components,
    [titles, onNavigate, resolveEmbed],
  );

  return (
    <div className="md-preview px-6 py-4">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        urlTransform={wikiUrlTransform}
        components={components}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
