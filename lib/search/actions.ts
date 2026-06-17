"use server";

import { query } from "@/lib/db/server";
import { parseSearchQuery } from "./query";

/** One ranked search result. Carries its own updated_at (NoteItem doesn't), and a snippet whose
 *  matches are wrapped in U+E000/U+E001 sentinels by ts_headline (the modal splits on them). */
export interface SearchHit {
  id: string;
  title: string;
  folder_id: string | null;
  snippet: string;
  rank: number;
  updated_at: string;
}

/** Full-text search. Parses the box into free-text + tag:/path:/prop: operators
 *  (lib/search/query.ts), then runs the `search_notes` RPC over the generated search_tsv. READ
 *  action → throws on error (per the lib/notes/actions.ts convention). */
export async function searchNotes(raw: string): Promise<SearchHit[]> {
  const { text, tag, path, props } = parseSearchQuery(raw);

  // Nothing to search → never hit the DB. (A text of only tsquery operators like "& | !" is
  // non-empty here and is left to websearch_to_tsquery, which is total and returns no rows.)
  if (text === "" && tag === null && path === null && props.length === 0) return [];

  const data = await query<SearchHit>(
    "select * from search_notes($1, $2, $3, $4::jsonb, $5::int)",
    [text, tag, path, JSON.stringify(props), 50],
  );
  // `real` arrives as a number, but coerce defensively (mirrors the bigint precedent in tags).
  return data.map((r) => ({ ...r, rank: Number(r.rank) }));
}
