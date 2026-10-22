import { eq } from "drizzle-orm";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { projects } from "./db/schema.ts";
import { newId } from "./ids.ts";

export type Project = typeof projects.$inferSelect;

export async function createProject(
  db: Db,
  input: { name: string; repoPath: string; remoteUrl?: string; holdoutsPath?: string; defaultBranch?: string },
): Promise<Project> {
  const [row] = await db.insert(projects).values({ id: newId("prj"), ...input }).returning();
  await audit(db, { actor: "board", kind: "project.created", subject: row!.id, data: { name: row!.name } });
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects);
}

export async function getProject(db: Db, id: string): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}
