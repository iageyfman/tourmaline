import type { Root, Element } from "hast";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Assign stable slug ids to TOP-LEVEL headings in document order, so the outline (3.5) can scroll
 * to them. Takes the SAME ordered slug list the outline renders (from `extractHeadings`), keyed by
 * occurrence — so a rendered heading's id always equals its outline slug, with zero drift. Only
 * direct children of the root get ids, exactly matching `extractHeadings` (which captures only
 * column-0 ATX headings); headings nested in blockquotes/lists are ignored by both.
 *
 * Runs as a rehype transform (NOT a React render component), so it's deterministic and immune to
 * StrictMode's render-phase double-invoke — the bug a render-time counter hits. Avoids a
 * rehype-slug dependency and shares one slug source with the outline.
 */
export function rehypeHeadingSlugs(slugs: string[]) {
  return (tree: Root) => {
    let i = 0;
    for (const child of tree.children) {
      if (child.type !== "element") continue;
      const el = child as Element;
      if (!HEADING_TAGS.has(el.tagName)) continue;
      const slug = slugs[i++];
      if (slug) el.properties = { ...(el.properties ?? {}), id: slug };
    }
    return tree;
  };
}
