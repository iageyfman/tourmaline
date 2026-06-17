import { maskCode, LINK_RE } from "../pipeline/parse";

/**
 * Embed target titles (`![[Title]]`) parsed from a body — render-side, for resolving
 * inline embeds. Reuses the canonical `maskCode` + `LINK_RE` so occurrences
 * inside fenced/inline code are skipped, matching the save pipeline EXACTLY. Like
 * `snippets.ts` and `remark-wiki-link.ts`, this mirrors the parser for presentation and is
 * NOT a second source of truth — it never writes the derived `links` table.
 *
 * Returns lowercased, de-duplicated titles; the caller maps these to note ids (the client
 * already holds every title→id) and fetches bodies by id.
 */
export function extractEmbedTitles(body: string): string[] {
  const masked = maskCode(body);
  const out = new Set<string>();
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(masked)) !== null) {
    if (m[1] !== "!") continue; // only embeds (`![[...]]`), not plain links
    const t = m[2].trim();
    if (t.length > 0) out.add(t.toLowerCase());
  }
  return [...out];
}
