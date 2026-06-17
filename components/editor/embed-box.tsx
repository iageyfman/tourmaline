"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkWikiLink } from "@/lib/markdown/remark-wiki-link";
import { remarkEmbedDepthReached } from "@/lib/markdown/remark-note-embed";
import { wikiAnchor, wikiUrlTransform } from "./wiki-anchor";

export interface EmbedTarget {
  title: string; // canonical title of the resolved target note
  body: string;
}

/**
 * One inline note embed. Renders the resolved target note's markdown inside a
 * visually framed box. The nested <ReactMarkdown> uses remarkEmbedDepthReached (NOT
 * remarkNoteEmbed), so an `![[...]]` inside the embedded note shows a depth placeholder rather
 * than recursing — the depth-1 cap is structural, no cycle detection. Inner
 * `[[links]]` stay navigable. An unresolved target renders a muted frame whose title
 * creates-on-click.
 */
export function EmbedBox({
  title,
  resolve,
  titles,
  onNavigate,
}: {
  title: string;
  resolve: (lowerTitle: string) => EmbedTarget | null;
  titles: Set<string>;
  onNavigate: (title: string) => void;
}) {
  const target = resolve(title.toLowerCase());
  if (!target) {
    return (
      <div className="embed-box embed-unresolved">
        <button className="embed-title" onClick={() => onNavigate(title)}>
          ↪ {title}
        </button>
        <p className="embed-empty">This note doesn’t exist yet.</p>
      </div>
    );
  }
  return (
    <div className="embed-box">
      <button className="embed-title" onClick={() => onNavigate(target.title)}>
        {target.title}
      </button>
      <div className="embed-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkWikiLink, remarkEmbedDepthReached]}
          urlTransform={wikiUrlTransform}
          components={{ a: wikiAnchor(titles, onNavigate) }}
        >
          {target.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
