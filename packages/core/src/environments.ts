import { eq } from "drizzle-orm";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { environments } from "./db/schema.ts";
import { newId } from "./ids.ts";

export type Environment = typeof environments.$inferSelect;

export async function createEnvironment(db: Db, input: { name: string; rootPath: string }): Promise<Environment> {
  const [row] = await db.insert(environments).values({ id: newId("env"), ...input }).returning();
  await audit(db, { actor: "board", kind: "environment.created", subject: row!.id, data: { name: row!.name } });
  return row!;
}

export async function listEnvironments(db: Db): Promise<Environment[]> {
  return db.select().from(environments);
}

export async function getEnvironment(db: Db, id: string): Promise<Environment | undefined> {
  const [row] = await db.select().from(environments).where(eq(environments.id, id));
  return row;
}

/** Every install has a default environment; projects without one belong to it. */
export async function ensureDefaultEnvironment(db: Db, rootPath: string): Promise<Environment> {
  const existing = await getEnvironment(db, "env_default");
  if (existing) return existing;
  const [row] = await db.insert(environments).values({ id: "env_default", name: "default", rootPath }).onConflictDoNothing().returning();
  return row ?? (await getEnvironment(db, "env_default"))!;
}
