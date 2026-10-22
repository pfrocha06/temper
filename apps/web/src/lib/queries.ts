import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, patch, post, put } from "./api";
import type { ProviderInfo } from "./providers";
import type {
  Agent,
  AgentEdit,
  Approval,
  Chat,
  ChatDetail,
  Dispatch,
  DispatchEvent,
  Environment,
  FactoryStatus,
  KnowledgeDetail,
  KnowledgeEntry,
  KnowledgeInput,
  KnowledgePatch,
  NewTicketInput,
  Project,
  SkillEntry,
  TemperatureReport,
  Ticket,
  TicketDetail,
  ProviderCaps,
  ToolsInventory,
  UsageReport,
} from "./types";

/** Query key roots. Live updates invalidate by root. */
export const keys = {
  status: ["status"] as const,
  projects: ["projects"] as const,
  tickets: ["tickets"] as const,
  ticket: (id: string) => ["ticket", id] as const,
  dispatches: ["dispatches"] as const,
  dispatch: (id: string) => ["dispatch", id] as const,
  approvals: ["approvals"] as const,
  agents: ["agents"] as const,
  skills: ["skills"] as const,
  temperature: ["temperature"] as const,
  environments: ["environments"] as const,
  knowledge: ["knowledge"] as const,
  chats: ["chats"] as const,
  chat: (id: string) => ["chat", id] as const,
  tools: ["tools"] as const,
  providers: ["providers"] as const,
  usage: ["usage"] as const,
  /** Proposals the board resolved in this session (the API lists pending approvals only). */
  resolvedProposals: ["resolved-proposals"] as const,
};

export type KeyRoot =
  | "status"
  | "projects"
  | "tickets"
  | "ticket"
  | "dispatches"
  | "dispatch"
  | "approvals"
  | "agents"
  | "skills"
  | "temperature"
  | "environments"
  | "knowledge"
  | "chats"
  | "chat"
  | "tools"
  | "providers"
  | "usage";

const enc = encodeURIComponent;

export const statusQuery = queryOptions({
  queryKey: keys.status,
  queryFn: () => api<FactoryStatus>("/status"),
  refetchInterval: 15_000,
});
export const projectsQuery = queryOptions({ queryKey: keys.projects, queryFn: () => api<Project[]>("/projects") });
export const ticketsQuery = (projectId: string | undefined) =>
  queryOptions({
    queryKey: [...keys.tickets, projectId ?? "all"],
    queryFn: () => api<Ticket[]>(projectId ? `/tickets?projectId=${encodeURIComponent(projectId)}` : "/tickets"),
  });
export const ticketQuery = (id: string) => queryOptions({ queryKey: keys.ticket(id), queryFn: () => api<TicketDetail>(`/tickets/${encodeURIComponent(id)}`) });
export const dispatchesQuery = queryOptions({ queryKey: keys.dispatches, queryFn: () => api<Dispatch[]>("/dispatches?limit=100") });
export const dispatchQuery = (id: string) =>
  queryOptions({ queryKey: keys.dispatch(id), queryFn: () => api<Dispatch>(`/dispatches/${encodeURIComponent(id)}`) });
export const dispatchEventsQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.dispatch(id), "events"],
    queryFn: () => api<DispatchEvent[]>(`/dispatches/${encodeURIComponent(id)}/events`),
    staleTime: Infinity,
  });
export const approvalsQuery = queryOptions({ queryKey: keys.approvals, queryFn: () => api<Approval[]>("/approvals") });
export const agentsQuery = queryOptions({ queryKey: keys.agents, queryFn: () => api<Agent[]>("/agents") });
export const skillsQuery = queryOptions({ queryKey: keys.skills, queryFn: () => api<SkillEntry[]>("/skills"), staleTime: 5 * 60_000 });
export const temperatureQuery = queryOptions({ queryKey: keys.temperature, queryFn: () => api<TemperatureReport>("/temperature") });

export const environmentsQuery = queryOptions({ queryKey: keys.environments, queryFn: () => api<Environment[]>("/environments") });
/** Everything in an environment, archived included: filters and search run on the client, `q` on the server. */
export const knowledgeQuery = (environmentId: string | undefined, q = "") =>
  queryOptions({
    queryKey: [...keys.knowledge, "list", environmentId ?? "", q],
    queryFn: () => api<KnowledgeEntry[]>(`/knowledge?environmentId=${enc(environmentId ?? "")}&archived=1${q ? `&q=${enc(q)}` : ""}`),
    enabled: Boolean(environmentId),
    placeholderData: (prev) => prev,
  });
export const knowledgeEntryQuery = (id: string) =>
  queryOptions({ queryKey: [...keys.knowledge, "entry", id], queryFn: () => api<KnowledgeDetail>(`/knowledge/${enc(id)}`) });
export const chatsQuery = (environmentId: string | undefined) =>
  queryOptions({
    queryKey: [...keys.chats, environmentId ?? ""],
    queryFn: () => api<Chat[]>(`/chats?environmentId=${enc(environmentId ?? "")}`),
    enabled: Boolean(environmentId),
  });
export const chatQuery = (id: string) => queryOptions({ queryKey: keys.chat(id), queryFn: () => api<ChatDetail>(`/chats/${enc(id)}`) });
export const toolsQuery = queryOptions({ queryKey: keys.tools, queryFn: () => api<ToolsInventory>("/tools"), staleTime: 60_000 });
export type UsageQuery = { from: string; to: string; projectId?: string };
export const usageQuery = (q: UsageQuery) =>
  queryOptions({
    queryKey: [...keys.usage, q.from, q.to, q.projectId ?? ""],
    queryFn: () => api<UsageReport>(`/usage?from=${enc(q.from)}&to=${enc(q.to)}${q.projectId ? `&projectId=${enc(q.projectId)}` : ""}`),
    // Keep the frame while a new range loads.
    placeholderData: (prev) => prev,
  });

/**
 * Resolved proposals kept client-side so a conversation can show their outcome. The query
 * function returns what is already cached, so a global refetch never empties it.
 */
export const resolvedProposalsQuery = (qc: QueryClient) =>
  queryOptions({
    queryKey: keys.resolvedProposals,
    queryFn: () => qc.getQueryData<Approval[]>(keys.resolvedProposals) ?? [],
    staleTime: Infinity,
    gcTime: Infinity,
  });

export function rememberResolved(qc: QueryClient, approval: Approval) {
  qc.setQueryData<Approval[]>(keys.resolvedProposals, (list = []) => [...list.filter((a) => a.id !== approval.id), approval]);
}

export function forgetResolved(qc: QueryClient, id: string) {
  qc.setQueryData<Approval[]>(keys.resolvedProposals, (list = []) => list.filter((a) => a.id !== id));
}

/** Probes each provider's CLI on the server, so it is not polled fast; finished runs invalidate it. */
export const providersQuery = queryOptions({ queryKey: keys.providers, queryFn: () => api<ProviderInfo[]>("/providers"), staleTime: 15_000, refetchInterval: 60_000 });

// ── mutations ─────────────────────────────────────────────────────────────

function useInvalidating<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, roots: ReadonlyArray<readonly string[]>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all(roots.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export const useSetPaused = () => useInvalidating((paused: boolean) => post<{ ok: true }>(paused ? "/pause" : "/resume"), [keys.status]);

export const useCreateTicket = () => useInvalidating((input: NewTicketInput) => post<Ticket>("/tickets", input), [keys.tickets, keys.status]);

export const useImportSpec = () =>
  useInvalidating(
    (input: { projectId: string; title: string; markdown: string; autoStart: boolean }) => post<Ticket[]>("/specs/import", input),
    [keys.tickets],
  );

export const useStartTicket = () => useInvalidating((id: string) => post<Ticket>(`/tickets/${encodeURIComponent(id)}/start`), [keys.tickets, ["ticket"]]);

export const useCancelTicket = () =>
  useInvalidating((id: string) => post<{ ok: true }>(`/tickets/${encodeURIComponent(id)}/cancel`), [keys.tickets, ["ticket"], keys.status]);

export const useReportEscape = () =>
  useInvalidating(
    ({ id, description }: { id: string; description: string }) => post<Ticket>(`/tickets/${encodeURIComponent(id)}/escape`, { description }),
    [keys.tickets, keys.temperature, keys.status],
  );

export const useSaveAgent = () =>
  useInvalidating(
    ({ id, edit }: { id: string; edit: AgentEdit }) => put<Agent>(`/agents/${encodeURIComponent(id)}`, edit),
    [keys.agents, keys.approvals, keys.status],
  );

export const useCreateEnvironment = () =>
  useInvalidating((input: { name: string; rootPath: string }) => post<Environment>("/environments", input), [keys.environments]);

export const useAddKnowledge = () => useInvalidating((input: KnowledgeInput) => post<KnowledgeEntry>("/knowledge", input), [keys.knowledge]);

export const useUpdateKnowledge = () =>
  useInvalidating(({ id, patch: body }: { id: string; patch: KnowledgePatch }) => patch<KnowledgeEntry>(`/knowledge/${enc(id)}`, body), [keys.knowledge]);

export const useStartChat = () =>
  useInvalidating((input: { environmentId: string; title: string; message: string }) => post<Chat>("/chats", input), [keys.chats]);

export const useSendChatMessage = () =>
  useInvalidating(({ chatId, message }: { chatId: string; message: string }) => post<{ ok: true }>(`/chats/${enc(chatId)}/messages`, { message }), [keys.chats, ["chat"]]);

export const useSetCaps = () =>
  useInvalidating(({ id, caps }: { id: string; caps: ProviderCaps }) => put<ProviderCaps>(`/providers/${enc(id)}/caps`, caps), [keys.providers, keys.status]);
