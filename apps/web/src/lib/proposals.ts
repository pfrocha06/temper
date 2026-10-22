import type { Approval, ChatMessage } from "./types";

/** What a confirmed proposal will do (server: agent-api.ts /proposals, factory.ts executeProposal). */
export type ProposalAction =
  | { action: "resolve_approval"; approvalId: string; resolution: string }
  | { action: "deploy"; ref: string; source: string }
  | { action: "unknown"; raw: Record<string, unknown> };

export function proposalAction(p: Pick<Approval, "payload">): ProposalAction {
  const raw = p.payload ?? {};
  if (raw.action === "resolve_approval" && typeof raw.approvalId === "string" && typeof raw.resolution === "string")
    return { action: "resolve_approval", approvalId: raw.approvalId, resolution: raw.resolution };
  if (raw.action === "deploy" && typeof raw.source === "string") return { action: "deploy", ref: typeof raw.ref === "string" && raw.ref ? raw.ref : "main", source: raw.source };
  return { action: "unknown", raw };
}

/** The proposal's own title without the server's `Chief proposes: ` prefix. */
export const proposalHeadline = (title: string) => title.replace(/^Chief proposes:\s*/i, "");

/** A repository path shortened to its last segment, for prose. */
export const repoName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * Where each of a conversation's proposals goes in the thread: after the Chief's reply to the
 * turn that made it, i.e. the first Chief message stored at or after the proposal. Proposals
 * made in a turn whose reply has not arrived yet go at the end (`trailing`).
 */
export function placeProposals(
  messages: Array<Pick<ChatMessage, "id" | "author" | "at">>,
  proposals: Array<Pick<Approval, "id" | "createdAt">>,
): { after: Map<number, string[]>; trailing: string[] } {
  const after = new Map<number, string[]>();
  const trailing: string[] = [];
  const replies = messages.filter((m) => m.author !== "board");
  for (const p of proposals.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const at = Date.parse(p.createdAt);
    const reply = replies.find((m) => Date.parse(m.at) >= at);
    if (!reply) trailing.push(p.id);
    else after.set(reply.id, [...(after.get(reply.id) ?? []), p.id]);
  }
  return { after, trailing };
}

/** A proposal's outcome as the board reads it. */
export function proposalOutcome(p: Pick<Approval, "status" | "resolution">): "pending" | "confirmed" | "declined" | "other" {
  if (p.status === "pending") return "pending";
  if (p.resolution === "confirm") return "confirmed";
  if (p.resolution === "decline") return "declined";
  return "other";
}

/** The target's title as the server wrote it into the proposal title (`… — <target title>`), for when the target is no longer listed. */
export function proposalTargetTitle(title: string): string | undefined {
  const i = title.indexOf(" — ");
  return i >= 0 ? title.slice(i + 3).trim() || undefined : undefined;
}
