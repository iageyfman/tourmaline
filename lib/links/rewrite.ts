import { normalizeBody, parseFrontmatter, maskCode, LINK_RE } from "../pipeline/parse";

/**
 * Link-target rewriting (merge + the rename cascade). PURE — no DB,
 * no framework. Reuses the canonical parser (maskCode + parseFrontmatter + LINK_RE), exactly
 * like lib/links/snippets.ts and lib/links/mentions.ts, so a link is never rewritten inside
 * fenced/inline code or inside the note's own frontmatter. Matching is whole-title and
 * case-insensitive (the app resolves titles by lower(title)); the canonical `toTitle` is
 * written, so `[[foo]]` rewriting "Foo"→"Bar" becomes `[[Bar]]`.
 */

/** Replace every non-newline char with a space (length- and line-count-preserving blanking). */
function blankStr(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

/**
 * A length- and newline-preserving copy of the (already normalized) body with the frontmatter
 * block and fenced/inline code blanked to spaces, but [[links]]/![[embeds]] LEFT INTACT (we
 * need to find them). Same first two steps as mentions.ts's maskForMentions — which then also
 * blanks the link spans (it looks for non-link text); we deliberately stop short so links stay
 * visible. Every transform preserves length, so offsets map 1:1 onto the original body.
 */
function maskFrontmatterAndCode(norm: string): string {
  const { contentStart } = parseFrontmatter(norm);
  let masked = maskCode(norm);
  if (contentStart > 0) {
    masked = blankStr(masked.slice(0, contentStart)) + masked.slice(contentStart);
  }
  return masked;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Rewrite every wiki-link / embed whose target title equals `fromTitle` (trimmed,
 * case-insensitive) to `toTitle`, preserving the leading "!" (embed) and any "|alias" — only
 * the inner title text is replaced. Code/frontmatter spans yield no matches → are never
 * touched. Replacements are spliced RIGHT-TO-LEFT so earlier offsets stay valid as later spans
 * change length. Whole-title equality (so "Foo"→"Bar" does NOT touch `[[Foobar]]`). Idempotent
 * when from≠to. Returns the normalized body unchanged when nothing matches.
 */
export function rewriteLinkTarget(body: string, fromTitle: string, toTitle: string): string {
  const from = fromTitle.trim().toLowerCase();
  const norm = normalizeBody(body);
  if (!from) return norm;

  const masked = maskFrontmatterAndCode(norm);
  const re = new RegExp(LINK_RE.source, LINK_RE.flags);
  const spans: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (m[2].trim().toLowerCase() !== from) continue;
    // m[1] = optional "!", then "[[" (2 chars), then group 2 = the raw inner title.
    const innerStart = m.index + m[1].length + 2;
    spans.push({ start: innerStart, end: innerStart + m[2].length });
  }

  let result = norm;
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i];
    result = result.slice(0, start) + toTitle + result.slice(end);
  }
  return result;
}
