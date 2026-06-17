import { maskCode } from "../pipeline/parse";

export interface Heading {
  level: number; // 1..6
  text: string; // heading text (original case, trimmed)
  line: number; // 0-based line index in the body
  slug: string; // stable id; duplicates suffixed -1, -2 (GitHub-style)
}

/**
 * Heading tree of a note body (for the outline). ATX headings only (`#`..`######`);
 * Setext (`===`/`---`) is out of scope (simpler-model tiebreaker). Reuses `maskCode`
 * so a `# foo` INSIDE a fenced code block is not mistaken for a heading. Pure + render-side
 * (not a derived-table writer). The SAME result feeds both the outline panel and the preview's
 * heading-id assignment, so the outline's slug always equals the rendered element id.
 */
export function extractHeadings(body: string): Heading[] {
  const masked = maskCode(body).split("\n"); // index-aligned: maskCode preserves line count
  const raw = body.split("\n");
  const counts = new Map<string, number>();
  const out: Heading[] = [];
  for (let i = 0; i < masked.length; i++) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(masked[i]); // require non-empty text after the hashes
    if (!m) continue;
    const text = raw[i].replace(/^\s*#{1,6}\s+/, "").trim(); // un-masked original text
    const base = slugify(text);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out.push({ level: m[1].length, text, line: i, slug: n === 0 ? base : `${base}-${n}` });
  }
  return out;
}

/** Lowercase, strip non-word punctuation, spaces→hyphens, collapse repeats. Empty → "section". */
export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}
