import { useQuery } from "@tanstack/react-query";
import { agentsQuery } from "@/lib/queries";
import type { Agent } from "@/lib/types";

const byIdOrRole = (agents: Agent[], key: string) => (agents.find((a) => a.id === key) ?? agents.find((a) => a.role === key))?.adapter;

/** The adapter an agent (by id, or by role) runs on, from the shared agents query. */
export function useAdapterOf(agentIdOrRole: string): string | undefined {
  const { data } = useQuery({ ...agentsQuery, select: (agents: Agent[]) => byIdOrRole(agents, agentIdOrRole), staleTime: 60_000 });
  return data;
}
