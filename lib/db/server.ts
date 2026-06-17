import { Pool, type PoolClient, type QueryResult, types } from "pg";

const DATE_OIDS = {
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
};

for (const oid of Object.values(DATE_OIDS)) {
  types.setTypeParser(oid, (value) => value);
}

export type DbClient = Pick<Pool | PoolClient, "query">;

declare global {
  // eslint-disable-next-line no-var
  var __tourmalinePgPool: Pool | undefined;
}

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (set it in .env.local).");
  }
  return connectionString;
}

export function getDbPool(): Pool {
  if (!globalThis.__tourmalinePgPool) {
    globalThis.__tourmalinePgPool = new Pool({
      connectionString: getConnectionString(),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__tourmalinePgPool;
}

export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  client: DbClient = getDbPool(),
): Promise<T[]> {
  const result: QueryResult<T> = await client.query(text, params);
  return result.rows;
}

export async function queryOne<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  client: DbClient = getDbPool(),
): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function execute(
  text: string,
  params: unknown[] = [],
  client: DbClient = getDbPool(),
): Promise<void> {
  await client.query(text, params);
}

export async function countRows(
  text: string,
  params: unknown[] = [],
  client: DbClient = getDbPool(),
): Promise<number> {
  const row = await queryOne<{ count: string }>(text, params, client);
  return Number(row?.count ?? 0);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
