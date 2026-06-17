import { normalizeBody, parseFrontmatter, maskCode, LINK_RE } from "../pipeline/parse";

/**
 * Unlinked-mention detection + the "link it" rewrite. PURE — no DB, no
 * framework. Reuses the canonical parser (maskCode + LINK_RE + parseFrontmatter), exactly
 * like lib/links/snippets.ts, so a mention is never found inside fenced/inline code, inside
 * an existing [[link]]/![[embed]], or inside the note's own frontmatter. Matching is
 * case-insensitive and whole-word — the app resolves titles case-insensitively
 * (notes_title_unique on lower(title)), so a plain "alpha" is a real mention of note "Alpha".
 */

/** One source note that mentions a target's title as plain text (mirrors `Backlink`). */
export interface UnlinkedMention {
  sourceId: string;
  sourceTitle: string;
  snippets: string[];
}

const WORD = /[\p{L}\p{N}]/u;

/** Escape a title so it can be embedded as a literal inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every non-newline char with a space (length- and line-count-preserving blanking). */
function blankStr(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

/**
 * A length- and newline-preserving copy of the (already normalized) body in which the
 * frontmatter block, fenced/inline code, and every existing [[link]]/![[embed]] span are
 * blanked to spaces. Any title occurrence that survives in here is a genuine unlinked
 * mention, and — because every transform preserves length — its offsets map 1:1 onto the
 * original body (for snippet lines and for the rewrite).
 */
function maskForMentions(norm: string): string {
  const { contentStart } = parseFrontmatter(norm);
  let masked = maskCode(norm);
  if (contentStart > 0) {
    masked = blankStr(masked.slice(0, contentStart)) + masked.slice(contentStart);
  }
  // group 0 covers the whole ![[Title|alias]], so neither the title nor the alias can leak.
  const linkRe = new RegExp(LINK_RE.source, LINK_RE.flags);
  masked = masked.replace(linkRe, (m) => blankStr(m));
  return masked;
}

/**
 * Case-insensitive, whole-word matcher for `title`. The word-boundary lookarounds are applied
 * ONLY on edges where the title's own edge char is a word char — so a title like `C++ (notes)`
 * (last char `)`) doesn't get a degenerate trailing lookahead that would over-match. Returns
 * null for a blank title.
 */
function titleMatcher(title: string): RegExp | null {
  const t = title.trim();
  if (!t) return null;
  const left = WORD.test(t[0]) ? "(?<![\\p{L}\\p{N}])" : "";
  const right = WORD.test(t[t.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(left + escapeRegExp(t) + right, "giu");
}

interface Span {
  start: number;
  end: number;
}

/** Offsets (into the normalized body) of every unlinked, non-code, non-frontmatter occurrence
 *  of `title`, in document order. */
function mentionSpans(norm: string, title: string): Span[] {
  const re = titleMatcher(title);
  if (!re) return [];
  const masked = maskForMentions(norm);
  const spans: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** The surrounding-line context for each unlinked mention of `title` in `body` (deduped by
 *  line, in document order) — the snippets shown in the unlinked-mentions panel. */
export function findUnlinkedMentions(body: string, title: string): string[] {
  const norm = normalizeBody(body);
  const spans = mentionSpans(norm, title);
  if (spans.length === 0) return [];
  const lines = norm.split("\n");
  const seen = new Set<number>();
  const out: string[] = [];
  for (const s of spans) {
    const li = norm.slice(0, s.start).split("\n").length - 1;
    if (seen.has(li)) continue;
    seen.add(li);
    out.push(lines[li].trim());
  }
  return out;
}

/**
 * "Link it": wrap every unlinked plain-text occurrence of `title` in `body` as `[[matched]]`,
 * preserving the literal matched text (resolution is case-insensitive, so `[[alpha]]` resolves
 * to note "Alpha"). Applied RIGHT-TO-LEFT so earlier offsets stay valid as later spans grow.
 * Code/link/frontmatter spans yield no spans → are never touched. Idempotent: a second pass
 * finds the now-linked text inside `[[…]]` and skips it (no double-wrap).
 */
export function linkMentionsInBody(body: string, title: string): string {
  const norm = normalizeBody(body);
  const spans = mentionSpans(norm, title);
  let result = norm;
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i];
    result = result.slice(0, start) + "[[" + result.slice(start, end) + "]]" + result.slice(end);
  }
  return result;
}
