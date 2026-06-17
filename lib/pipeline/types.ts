/** One [[wiki link]] or ![[embed]] extracted from a note body. */
export interface ParsedLink {
  /** Raw text inside [[ ]], trimmed, with any |alias stripped. Case preserved. */
  targetTitle: string;
  /** true for ![[note]] embeds. */
  isEmbed: boolean;
  /** 0-based order of appearance in the body. */
  position: number;
}

/** Result of parsing a note's title + body (pure; no DB). */
export interface ParsedNote {
  title: string;
  /** Normalized body (CRLF -> LF). This is what gets persisted. */
  body: string;
  /** Parsed YAML frontmatter, or { _raw_error, _raw } when the YAML is invalid. */
  properties: Record<string, unknown>;
  /** Links in document order. */
  links: ParsedLink[];
  /** Normalized lowercase tags, deduped, merged from body + frontmatter `tags:`. */
  tags: string[];
}
