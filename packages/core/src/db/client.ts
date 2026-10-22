import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.ts";

export type Db = PgliteDatabase<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** Opens (and migrates) the database. Omit `dataDir` for an in-memory database. */
export async function openDb(dataDir?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
