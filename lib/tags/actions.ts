"use server";

import { query } from "@/lib/db/server";

/** All tags carried by ≥1 live note, with distinct-note counts (SPEC 2.3). Read-only over
 *  the derived tags/note_tags tables. */
export async function listTagsWithCounts(): Promise<{ name: string; count: number }[]> {
  const data = await query<{ name: string; count: number | string }>("select * from list_tags_with_counts()");
  // bigint may arrive as a string via PostgREST — coerce so the tree's arithmetic is numeric.
  return data.map((r) => ({
    name: r.name,
    count: Number(r.count),
  }));
}

/** Notes carrying `name` or any descendant tag (`name/...`), for the tag-click results. */
export async function notesByTag(name: string): Promise<{ id: string; title: string }[]> {
  return query<{ id: string; title: string }>("select * from notes_by_tag($1)", [name]);
}
