/**
 * Search-box query parser. PURE — splits a raw search string into a free-text
 * term plus the `tag:` / `path:` / `prop:` operators, which the server passes as discrete
 * params to the `search_notes` RPC.
 *
 * This is NOT note-content parsing: it reads a transient UI string, not a saved note body, and
 * never touches frontmatter/[[links]]/#tags. So it is a separate concern from the one note
 * parser in lib/pipeline/parse.ts — deliberately shares no regex.
 *
 * Operators are anchored at a word boundary `(^|\s)` so `https://x` is never read as `path:`.
 * Operator VALUES may be double-quoted to carry spaces (`path:"Meeting Notes"`,
 * `prop:status="in progress"`). The free-text remainder keeps its own quotes so a phrase query
 * like `"foo bar"` survives intact for websearch_to_tsquery.
 *
 *   tag:x      first occurrence wins (extras ignored); matched against tag + descendants in SQL
 *   path:x     first occurrence wins; matched against a folder name + its subtree in SQL
 *   prop:k=v   all occurrences AND together; value may be quoted; `prop:k` (no =) = key existence
 *   prop:k=    (empty value) = literal empty-string match (documented edge)
 */
export interface ParsedSearchQuery {
  text: string;
  tag: string | null;
  path: string | null;
  props: { key: string; value: string | null }[];
}

// key = run of non-space/non-`=`/non-quote chars; value = "quoted" (may be empty) or a non-space
// run (\S* so `prop:k=` yields ""). The `(?:=…)?` is absent only when there is no `=` → value null.
const PROP_RE = /(?:^|\s)prop:([^\s="]+)(?:=(?:"([^"]*)"|(\S*)))?/gi;
const TAG_RE = /(?:^|\s)tag:(?:"([^"]*)"|(\S+))/gi;
const PATH_RE = /(?:^|\s)path:(?:"([^"]*)"|(\S+))/gi;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  let work = raw ?? "";

  const props: { key: string; value: string | null }[] = [];
  for (const m of work.matchAll(PROP_RE)) {
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : null;
    props.push({ key: m[1], value });
  }
  work = work.replace(PROP_RE, " ");

  let tag: string | null = null;
  for (const m of work.matchAll(TAG_RE)) {
    tag = m[1] ?? m[2];
    break; // first wins
  }
  work = work.replace(TAG_RE, " ");

  let path: string | null = null;
  for (const m of work.matchAll(PATH_RE)) {
    path = m[1] ?? m[2];
    break; // first wins
  }
  work = work.replace(PATH_RE, " ");

  const text = work.replace(/\s+/g, " ").trim();
  return { text, tag, path, props };
}
