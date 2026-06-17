import { parseDocument, Document, isMap } from "yaml";

/**
 * Frontmatter write-back for the properties panel (SPEC 2.4) — SERVER-ONLY (imported by
 * the property server action, never by a client component). It is the inverse of the
 * pipeline's frontmatter PARSE, so it lives beside it conceptually: edit the body's raw
 * YAML, then the normal save pipeline re-derives `notes.properties`.
 *
 * Uses the `yaml` Document API so unchanged keys keep their order and comments (vs
 * parse→stringify which drops them). The pipeline's regex is mirrored exactly.
 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(\n|$)/;

/** Thrown when the note's existing frontmatter is not valid YAML — the caller refuses
 *  the edit rather than silently "repairing" (destroying) the user's raw text. */
export class InvalidYamlError extends Error {
  constructor(message = "frontmatter YAML is invalid") {
    super(message);
    this.name = "InvalidYamlError";
  }
}

function splitFrontmatter(body: string): { yamlText: string; content: string } | null {
  const m = FRONTMATTER_RE.exec(body);
  if (!m) return null;
  return { yamlText: m[1], content: body.slice(m[0].length) };
}

// doc.toString() ends in "\n", so this yields a block that matches FRONTMATTER_RE at byte 0.
function rebuild(doc: Document, content: string): string {
  return `---\n${doc.toString()}---\n${content}`;
}

function parseChecked(yamlText: string): Document {
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) throw new InvalidYamlError();
  if (doc.contents != null && !isMap(doc.contents)) throw new InvalidYamlError("frontmatter is not a mapping");
  return doc;
}

function isEmptyDoc(doc: Document): boolean {
  const c = doc.contents;
  if (c == null) return true;
  return isMap(c) && c.items.length === 0;
}

/** Set/add a frontmatter key. If the note has no frontmatter, prepend a fresh block. */
export function upsertFrontmatterProperty(body: string, key: string, value: unknown): string {
  const split = splitFrontmatter(body);
  if (split) {
    const doc = parseChecked(split.yamlText);
    doc.set(key, value);
    return rebuild(doc, split.content);
  }
  const doc = new Document({});
  doc.set(key, value); // only ever called to ADD, so the block is non-empty
  return rebuild(doc, body);
}

/** Remove a frontmatter key. Dropping the last key removes the whole block (never `{}`). */
export function removeFrontmatterProperty(body: string, key: string): string {
  const split = splitFrontmatter(body);
  if (!split) return body;
  const doc = parseChecked(split.yamlText);
  doc.delete(key);
  if (isEmptyDoc(doc)) return split.content;
  return rebuild(doc, split.content);
}
