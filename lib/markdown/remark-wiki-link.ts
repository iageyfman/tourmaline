import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";

/**
 * Remark plugin (preview side). Turns `[[Title]]` / `[[Title|alias]]`
 * into clickable mdast `link` nodes (`url: "wiki:<title>"`); the alias becomes the link
 * text. `![[embeds]]` are deliberately excluded (negative lookbehind) and stay plain text
 * (inline embed render is handled separately).
 *
 * Presentation-only. The canonical link extraction that feeds the `links` table is
 * `LINK_RE` in lib/pipeline/parse.ts — this mirrors its title-matching for rendering and
 * is NOT a second source of truth. Operating on mdast `text` nodes means `[[links]]`
 * inside fenced/inline code are never touched (code is its own node type), so this honors
 * the "never parse links in code" rule for free.
 */
export function remarkWikiLink() {
  return (tree: Root) => {
    // Fresh regex per run (global flag is stateful; avoid leaking lastIndex across renders).
    const WIKI_RE = /(?<!!)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;
    findAndReplace(tree, [
      [
        WIKI_RE,
        (_full: string, title: string, alias?: string) => {
          const target = title.trim();
          const text = (alias ?? title).trim();
          return {
            type: "link",
            url: `wiki:${target}`,
            children: [{ type: "text", value: text }],
          };
        },
      ],
    ]);
  };
}
