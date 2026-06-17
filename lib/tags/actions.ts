"use server";

import { createServerClient } from "@/lib/supabase/server";

/** All tags carried by ≥1 live note, with distinct-note counts (SPEC 2.3). Read-only over
 *  the derived tags/note_tags tables. */
export async function listTagsWithCounts(): Promise<{ name: string; count: number }[]> {
  const { data, error } = await createServerClient().rpc("list_tags_with_counts");
  if (error) throw new Error(error.message);
  // bigint may arrive as a string via PostgREST — coerce so the tree's arithmetic is numeric.
  return ((data ?? []) as { name: string; count: number | string }[]).map((r) => ({
    name: r.name,
    count: Number(r.count),
  }));
}

/** Notes carrying `name` or any descendant tag (`name/...`), for the tag-click results. */
export async function notesByTag(name: string): Promise<{ id: string; title: string }[]> {
  const { data, error } = await createServerClient().rpc("notes_by_tag", { p_tag: name });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; title: string }[];
}
