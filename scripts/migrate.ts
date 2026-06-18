import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const LOCK_ID = 758409182;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL (set it in .env.local).");

  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const client = await pool.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      create table if not exists _tourmaline_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");
      const checksum = sha256(sql);
      const applied = await client.query<{ checksum: string }>(
        "select checksum from _tourmaline_migrations where filename = $1",
        [file],
      );

      if (applied.rowCount && applied.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed after apply: ${file}`);
      }
      if (applied.rowCount) {
        process.stdout.write(`Skipping ${file}... already applied\n`);
        continue;
      }

      process.stdout.write(`Applying ${file}... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into _tourmaline_migrations (filename, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
      process.stdout.write("ok\n");
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [LOCK_ID]);
    } finally {
      client.release();
    }
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
