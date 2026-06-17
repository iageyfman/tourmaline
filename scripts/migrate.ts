import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL (set it in .env.local).");

  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  try {
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = await readFile(fullPath, "utf8");
      process.stdout.write(`Applying ${file}... `);
      await pool.query(sql);
      process.stdout.write("ok\n");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
