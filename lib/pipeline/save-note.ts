import { queryOne, type DbClient } from "@/lib/db/server";
import { parseNote } from "./parse";

export interface SaveNoteInput {
  /** Omit / null to create a new note; provide to update an existing one. */
  id?: string | null;
  title: string;
  body: string;
  folderId?: string | null;
}

/**
 * The save pipeline. Parses the note in TypeScript, then hands the
 * structured result to the `save_note` Postgres function, which performs all DB
 * writes (rebuild links + tags, debounced revision, claim unresolved, bump
 * updated_at) atomically in one transaction.
 *
 * Framework-agnostic: can take a transaction/client, so server actions and the
 * exit-test script share exactly one code path.
 */
export async function saveNote(input: SaveNoteInput, client?: DbClient): Promise<Record<string, unknown>>;
export async function saveNote(client: unknown, input: SaveNoteInput): Promise<Record<string, unknown>>;
export async function saveNote(
  first: SaveNoteInput | DbClient | unknown,
  second?: SaveNoteInput | DbClient,
): Promise<Record<string, unknown>> {
  const input = isSaveNoteInput(first) ? first : (second as SaveNoteInput);
  const client = isDbClient(first) ? first : isDbClient(second) ? second : undefined;
  const parsed = parseNote({ title: input.title, body: input.body });

  const links = parsed.links.map((l) => ({
    target_title: l.targetTitle,
    is_embed: l.isEmbed,
    position: l.position,
  }));

  try {
    const row = await queryOne<{ note: Record<string, unknown> }>(
      "select save_note($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6::jsonb, $7::text[]) as note",
      [
        input.id ?? null,
        parsed.title,
        parsed.body,
        input.folderId ?? null,
        JSON.stringify(parsed.properties),
        JSON.stringify(links),
        parsed.tags,
      ],
      client,
    );
    if (!row) throw new Error("save_note returned no row");
    return row.note;
  } catch (e) {
    // Preserve the Postgres error code so callers can map e.g. 23505 (unique title).
    const err = new Error(`save_note failed: ${e instanceof Error ? e.message : String(e)}`) as Error & {
      code?: string;
    };
    err.code = (e as { code?: string }).code;
    throw err;
  }
}

function isSaveNoteInput(value: unknown): value is SaveNoteInput {
  return typeof value === "object" && value !== null && "title" in value && "body" in value;
}

function isDbClient(value: unknown): value is DbClient {
  return typeof (value as DbClient | undefined)?.query === "function";
}
