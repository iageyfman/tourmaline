import { maskCode, LINK_RE } from "../pipeline/parse";

export interface Backlink {
  sourceId: string;
  sourceTitle: string;
  snippets: string[];
}

/**
 * Lines of `body` that contain a real wiki-link/embed to `targetTitle` — the surrounding-
 * line context for the backlinks panel. Reuses maskCode + LINK_RE (the same
 * parser that built the link rows), so occurrences inside fenced/inline code are skipped,
 * matching the pipeline exactly. `position` in the links table is appearance ORDER, not an
 * offset, so we re-scan the body here rather than trying to use it.
 */
export function backlinkSnippets(body: string, targetTitle: string): string[] {
  const target = targetTitle.trim().toLowerCase();
  const original = body.split("\n");
  const masked = maskCode(body).split("\n"); // index-aligned: maskCode preserves line count
  const out: string[] = [];
  for (let i = 0; i < masked.length; i++) {
    for (const m of masked[i].matchAll(LINK_RE)) {
      if (m[2].trim().toLowerCase() === target) {
        out.push(original[i].trim());
        break;
      }
    }
  }
  return out;
}
