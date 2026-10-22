import type { Artifact, Stage, Ticket } from "@temper/core";

type AgentStage = Extract<Stage, { kind: "agent" }>;

/** Artifacts the Builder must never see: they can carry holdout detail. */
export const HIDDEN_FROM_BUILDER = new Set(["verification.md", "eval.md", "gates.md"]);

/** Feedback is passed explicitly, never as an "earlier output". */
export const FEEDBACK_ARTIFACT = "feedback.md";

export type PromptInput = {
  ticket: Ticket;
  stage: AgentStage;
  artifacts: Artifact[];
  feedback?: string;
  appUrl?: string;
  holdoutsPath?: string | null;
  worktreePath?: string | null;
  context?: string;
  /** Shared knowledge digest (titles + abstracts) relevant to this ticket. */
  knowledge?: string;
};

export function visibleArtifacts(role: AgentStage["role"], artifacts: Artifact[]): Artifact[] {
  return role === "builder" ? artifacts.filter((a) => !HIDDEN_FROM_BUILDER.has(a.name)) : artifacts;
}

export function buildPrompt(input: PromptInput): string {
  const { ticket, stage } = input;
  const parts: string[] = [];
  parts.push(`You are the ${stage.role} in Temper, an autonomous software factory. Work carefully; your output is checked independently.`);
  parts.push(`# Ticket ${ticket.id}: ${ticket.title} (${ticket.type})`);
  if (ticket.spec.trim()) parts.push(`## Spec\n${ticket.spec.trim()}`);
  if (ticket.acceptanceCriteria.length) {
    parts.push(`## Acceptance criteria\n${ticket.acceptanceCriteria.map((c) => `- ${c.id}: ${c.text}`).join("\n")}`);
  }
  if (ticket.fileScope.length) parts.push(`## File scope\nOnly change files matching:\n${ticket.fileScope.map((s) => `- ${s}`).join("\n")}`);

  const visible = visibleArtifacts(stage.role, input.artifacts).filter((a) => a.name !== stage.artifact && a.name !== FEEDBACK_ARTIFACT);
  if (visible.length) {
    parts.push(`## Earlier stage outputs\n${visible.map((a) => `### ${a.name}\n${a.content.trim()}`).join("\n\n")}`);
  }
  if (input.feedback) parts.push(`## Feedback from the previous attempt\n${input.feedback.trim()}`);
  if (input.context) parts.push(`## Context\n${input.context.trim()}`);
  if (input.knowledge) {
    parts.push(
      `## Shared knowledge\nCurated by the Chief of Staff for this environment. Use the \`knowledge_get\` tool for detail and \`knowledge_search\` for more.\n${input.knowledge}`,
    );
  }

  if (stage.role === "verifier") {
    const where: string[] = [];
    if (input.holdoutsPath) {
      where.push(`The holdouts repository is your working directory (${input.holdoutsPath}). Follow its README.md conventions.`);
      where.push(`Write this ticket's checks under \`tickets/${ticket.id}/\`. Never weaken or delete existing checks.`);
    }
    if (input.worktreePath) where.push(`The candidate code is at ${input.worktreePath}. Do not modify it.`);
    if (input.appUrl) where.push(`The candidate app is running at ${input.appUrl}.`);
    where.push("Run the suite with `node run.mjs` (TEMPER_APP_URL, TEMPER_TICKET_ID and TEMPER_REGRESSION_TICKETS are set). For UI behaviour, use `lib/browser.mjs` (Playwright, headless Chromium).");
    where.push("Report each criterion on its own line as `AC-<id>: PASS` or `AC-<id>: FAIL <one-line reason>`.");
    parts.push(`## Environment\n${where.join("\n")}`);
  }

  parts.push(`# Your stage: ${stage.id}\n${stage.instructions.trim()}`);

  const rules = [
    stage.artifact
      ? `Your final message is saved as \`${stage.artifact}\`. Write it as that document, concise and specific.`
      : "Your final message is saved as the stage summary.",
    "End your final message with exactly one line: `VERDICT: PASS`, `VERDICT: FAIL` or `VERDICT: BLOCKED`.",
    "Use BLOCKED only when you need a human decision; say exactly what decision.",
    "Never push, add remotes, or call the git host. The server handles all of that.",
  ];
  if (stage.readOnly) rules.push("Do not modify any files.");
  if (stage.role === "builder") rules.push("Commit your work locally in small commits with clear messages before you finish.");
  rules.push(
    "If you learned something durable that would save the next agent time (an environment quirk, a convention, a gotcha), add a short `## Learnings` section. The Chief of Staff decides what to keep.",
  );
  parts.push(`# Rules\n${rules.map((r) => `- ${r}`).join("\n")}`);
  return parts.join("\n\n");
}

export const CHIEF_INTAKE_PROMPT = (title: string, spec: string) => `You are the Chief of Staff in Temper, an autonomous software factory.

First use the \`knowledge_search\` tool for anything already known about this area. If the spec
reveals durable facts or decisions, record them with \`knowledge_add\`.

Split the spec below into tracer-bullet tickets: each one a thin vertical slice that delivers
observable behaviour end to end, small enough for one focused session.

For each ticket give: a key (T1, T2, …), type (feature | bugfix | refactor | investigation |
prototype | perf | chore | skill | verification), title, a short spec, 1–5 acceptance
criteria (each independently checkable against the running app), a file scope (path globs),
and dependsOn (keys of tickets that must be done first).

Reply with one fenced \`\`\`json block containing:
{"tickets": [{"key": "T1", "type": "feature", "title": "…", "spec": "…",
  "acceptanceCriteria": ["…"], "fileScope": ["…"], "dependsOn": []}]}
then a final line \`VERDICT: PASS\` (or \`VERDICT: BLOCKED\` with the question you need answered).

# Spec: ${title}
${spec}`;

export const CHIEF_DIGEST_PROMPT = (ticket: Ticket, projectName: string, artifacts: Artifact[], knowledge?: string) => `You are the Chief of Staff in Temper. Ticket ${ticket.id} ("${ticket.title}", ${ticket.type}) in project ${projectName} has just finished.

Curate the shared knowledge base from what the agents reported. Read the outputs below, especially
any "Learnings" sections, gate failures and reviewer findings.

- Add durable facts with \`knowledge_add\`: environment quirks, conventions, decisions, gotchas, how-tos.
- Correct entries the work proved wrong with \`knowledge_update\`; retire obsolete ones with \`knowledge_archive\`.
- Search first (\`knowledge_search\`) so you update instead of duplicating.
- Never record unverified claims about what the code does, test contents, or secrets. Prefer few, high-value entries; adding nothing is fine.

End with a one-paragraph summary of what you changed and \`VERDICT: PASS\`.

## Current knowledge
${knowledge ?? "(none yet)"}

## Ticket outputs
${artifacts
  .filter((a) => a.name !== "feedback.md")
  .map((a) => `### ${a.name}\n${a.content.slice(0, 6000)}`)
  .join("\n\n")}`;

export const CHIEF_CHAT_PROMPT = (envName: string, rootPath: string, knowledge: string | undefined, message: string) => `You are the Chief of Staff in Temper, talking with the board (the human who owns this factory).
Environment: ${envName} (${rootPath}). You can read the repositories under it, search and record shared
knowledge, list projects and tickets, and create tickets to delegate work (tools: knowledge_*, projects_list,
tickets_list, ticket_create).

How to work:
- When the board brings a new idea, grill them: ask the open questions one round at a time, numbered, each with
  your recommended answer, until the design is clear. Then propose tracer-bullet tickets and create them only
  once the board agrees.
- When asked a question, answer from the code and the knowledge base, citing files.
- Record durable decisions and facts the board tells you with knowledge_add.
- Be concise.

## Shared knowledge
${knowledge ?? "(none yet)"}

## The board says
${message}`;
