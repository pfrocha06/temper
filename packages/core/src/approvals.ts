import { asc, eq } from "drizzle-orm";
import { audit, type Actor } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { approvals } from "./db/schema.ts";
import { newId } from "./ids.ts";

export const APPROVAL_KINDS = [
  "merge",
  "deploy",
  "holdout_change",
  "agent_change",
  "skill",
  "workflow",
  "autonomy",
  "spot_check",
  "escalation",
  "decision",
  "notice",
  "proposal",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export type Approval = typeof approvals.$inferSelect;

export async function requestApproval(
  db: Db,
  input: {
    kind: ApprovalKind;
    title: string;
    body?: string;
    ticketId?: string;
    options?: string[];
    payload?: Record<string, unknown>;
    chatId?: string;
  },
): Promise<Approval> {
  const [row] = await db.insert(approvals).values({ id: newId("apv"), ...input }).returning();
  await audit(db, { actor: "system", kind: "approval.requested", subject: row!.id, data: { kind: input.kind, ticketId: input.ticketId } });
  return row!;
}

export async function pendingApprovals(db: Db): Promise<Approval[]> {
  return db.select().from(approvals).where(eq(approvals.status, "pending")).orderBy(asc(approvals.createdAt));
}

export async function resolveApproval(db: Db, id: string, resolution: string, note?: string, actor: Actor = "board"): Promise<Approval> {
  const [current] = await db.select().from(approvals).where(eq(approvals.id, id));
  if (!current) throw new Error(`approval ${id} not found`);
  if (current.status !== "pending") throw new Error(`approval ${id} is already ${current.status}`);
  if (!current.options.includes(resolution)) throw new Error(`'${resolution}' is not one of ${current.options.join(", ")}`);
  const [row] = await db
    .update(approvals)
    .set({ status: "resolved", resolution, note, resolvedAt: new Date() })
    .where(eq(approvals.id, id))
    .returning();
  await audit(db, { actor, kind: "approval.resolved", subject: id, data: { resolution, note } });
  return row!;
}

export async function getApproval(db: Db, id: string): Promise<Approval | undefined> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
  return row;
}
