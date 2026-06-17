import type { Root, Paragraph } from "mdast";

// An `![[Title]]` (optionally `![[Title|alias]]`) that is ALONE on its own line/paragraph.
// Inline embeds (mid-sentence) are intentionally NOT matched — they stay literal text, which
// avoids ever placing a block frame inside a <p> (the react-markdown invalid-nesting trap).
const EMBED_ONLY = /^!\[\[([^[\]|]+?)(?:\|[^[\]]*)?\]\]$/;

/** The embed target title if this paragraph is exactly a single-text `![[Title]]`, else null. */
function embedTitle(node: Paragraph): string | null {
  if (node.children.length !== 1 || node.children[0].type !== "text") return null;
  const m = EMBED_ONLY.exec(node.children[0].value.trim());
  return m ? m[1].trim() : null;
}

/**
 * Remark plugin. Turns a paragraph that is exactly `![[Title]]` into a block-level
 * `<note-embed title="...">` element (mapped to <EmbedBox> in the preview). We replace the WHOLE
 * paragraph node — never inject a block inside the <p> — so there is no invalid <div>-in-<p>
 * nesting. Top-level paragraphs only (MVP; `![[X]]` as the sole content of a list item /
 * blockquote stays literal). Presentation-only; the canonical embed extraction that feeds the
 * `links` table is LINK_RE in lib/pipeline/parse.ts.
 */
export function remarkNoteEmbed() {
  return (tree: Root) => {
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      if (node.type !== "paragraph") continue;
      const title = embedTitle(node);
      if (title == null) continue;
      tree.children[i] = {
        type: "paragraph", // a real mdast type; hName overrides the rendered tag
        data: { hName: "note-embed", hProperties: { title } },
        children: [],
      } as Paragraph;
    }
  };
}

/**
 * The depth-1 cap, used by the NESTED renderer inside <EmbedBox>: identical
 * own-paragraph `![[...]]` detection, but it emits a literal "embed depth reached" placeholder
 * instead of an embed node. Because the nested renderer uses THIS instead of remarkNoteEmbed, an
 * embed inside an embed can never produce another <EmbedBox> — the cap is structural (no counter,
 * no cycle detection). Inner `[[links]]` are left untouched for remarkWikiLink (still navigable).
 */
export function remarkEmbedDepthReached() {
  return (tree: Root) => {
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      if (node.type !== "paragraph") continue;
      if (embedTitle(node) == null) continue;
      tree.children[i] = {
        type: "paragraph",
        data: { hProperties: { className: "embed-depth-reached" } },
        children: [{ type: "text", value: "↪ embed depth reached" }],
      } as Paragraph;
    }
  };
}
