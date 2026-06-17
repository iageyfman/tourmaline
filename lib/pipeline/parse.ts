import { parse as parseYaml } from "yaml";
import type { ParsedLink, ParsedNote } from "./types";

/**
 * The note parser. PURE — no DB, no framework. All link/tag/
 * frontmatter parsing for the whole app lives here.
 *
 * The #1 source of garbage links is extracting from code, so we mask
 * fenced + inline code BEFORE scanning for links and tags.
 */
export function parseNote(input: { title: string; body: string }): ParsedNote {
  const body = normalizeBody(input.body);
  const { properties, fmTags, contentStart } = parseFrontmatter(body);

  // Scan only the content below the frontmatter block; mask code first.
  const masked = maskCode(body.slice(contentStart));
  const links = extractLinks(masked);
  const bodyTags = extractTags(masked);

  const tags = dedupe([...bodyTags, ...fmTags]);

  return { title: input.title, body, properties, links, tags };
}

/** Normalize line endings so frontmatter detection, positions, and revisions agree. */
export function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Frontmatter must start at byte 0 (`---\n`) and close on a line that is exactly
 * `---` (we deliberately do NOT honor YAML's `...` terminator).
 * Invalid YAML is stored under _raw_error and does NOT block the save; body tags
 * are still extracted (contentStart is past the closing fence regardless).
 */
export function parseFrontmatter(normalizedBody: string): {
  properties: Record<string, unknown>;
  fmTags: string[];
  contentStart: number;
} {
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(normalizedBody);
  if (!m) return { properties: {}, fmTags: [], contentStart: 0 };

  const yamlText = m[1];
  const contentStart = m[0].length;
  try {
    const parsed = parseYaml(yamlText);
    const properties =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { properties, fmTags: coerceTags(properties["tags"]), contentStart };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { properties: { _raw_error: message, _raw: yamlText }, fmTags: [], contentStart };
  }
}

/**
 * Offset-preserving code mask. Fenced blocks are handled FIRST (whole-line, so inner
 * backticks/`#`/`[[` can't leak), then inline code per line (never crossing newlines).
 * Pragmatic, not full CommonMark: 4-space indented code blocks are NOT masked.
 */
export function maskCode(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;

  for (const line of lines) {
    // Fence open/close: up to 3 leading spaces, then >=3 backticks or tildes.
    const m = /^(\s{0,3})(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(" ".repeat(line.length)); // inside fence: blank the whole line
      if (m && m[2][0] === fence.char && m[2].length >= fence.len) {
        fence = null; // closing fence (also blanked)
      }
      continue;
    }
    if (m) {
      fence = { char: m[2][0], len: m[2].length };
      out.push(" ".repeat(line.length)); // opening fence line blanked
      continue;
    }
    out.push(maskInline(line));
  }
  return out.join("\n");
}

/** Mask inline code: a run of N backticks closed by the first run of exactly N, same line. */
function maskInline(line: string): string {
  const chars = line.split("");
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (chars[i + n] === "`") n++; // opening run length
    let j = i + n;
    let closed = false;
    while (j < chars.length) {
      if (chars[j] === "`") {
        let k = 0;
        while (chars[j + k] === "`") k++;
        if (k === n) {
          for (let p = i; p < j + k; p++) chars[p] = " ";
          i = j + k;
          closed = true;
          break;
        }
        j += k;
      } else {
        j++;
      }
    }
    if (!closed) i += n; // unterminated run: leave the rest of the line intact
  }
  return chars.join("");
}

// One pattern; optional leading ! => embed; optional |alias is consumed and discarded
// (the links table has no alias column). Exported so the backlinks snippet matcher
// (lib/links/snippets.ts) uses the exact regex that built the link rows.
export const LINK_RE = /(!?)\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]/g;

export function extractLinks(maskedBody: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  let m: RegExpExecArray | null;
  let position = 0;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(maskedBody)) !== null) {
    const targetTitle = m[2].trim();
    if (targetTitle.length === 0) continue; // [[ ]] / [[|x]] -> skip
    out.push({ targetTitle, isEmbed: m[1] === "!", position: position++ });
  }
  return out;
}

// '#' at a word boundary, tag chars are unicode letters/digits/_/-//, must contain >=1 letter
// (so `#fff` is a tag but `#123` is not; `# heading` never matches — space isn't a tag char).
const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu;

export function extractTags(maskedBody: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(maskedBody)) !== null) {
    const t = normalizeTag(m[2]);
    if (t) out.push(t);
  }
  return out;
}

/** Lowercase, strip leading #, collapse/trim slashes, reject pure-numeric. */
export function normalizeTag(raw: string): string | null {
  let t = raw.trim().replace(/^#+/, "");
  t = t.replace(/\/{2,}/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (t.length === 0) return null;
  if (!/\p{L}/u.test(t)) return null;
  return t.toLowerCase();
}

/** Coerce a frontmatter `tags:` value (list / [a,b] / "a" / "a, b") into normalized tags. */
function coerceTags(value: unknown): string[] {
  if (value == null) return [];
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split(",");
  else items = [value];

  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const t = normalizeTag(String(item));
    if (t) out.push(t);
  }
  return out;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
