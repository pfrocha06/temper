import { useQuery } from "@tanstack/react-query";
import { createContext, use, useState, type ReactNode } from "react";
import { DEFAULT_ENVIRONMENT } from "@/lib/constants";
import { environmentsQuery } from "@/lib/queries";
import type { Environment } from "@/lib/types";

type EnvironmentContext = {
  environments: Environment[];
  /** The selected environment, else `env_default`, else the first; undefined while loading or when there are none. */
  environment: Environment | undefined;
  select: (id: string) => void;
  isLoading: boolean;
};

const Ctx = createContext<EnvironmentContext | null>(null);
const STORAGE_KEY = "temper.environment";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Picks the environment to show: the stored choice if it still exists, else the default, else the first. */
export function resolveEnvironment(environments: Environment[], selectedId: string | null): Environment | undefined {
  return environments.find((e) => e.id === selectedId) ?? environments.find((e) => e.id === DEFAULT_ENVIRONMENT) ?? environments[0];
}

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const { data: environments = [], isLoading } = useQuery(environmentsQuery);
  const [selectedId, setSelectedId] = useState<string | null>(readStored);
  const environment = resolveEnvironment(environments, selectedId);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Selection still applies for this session.
    }
  };

  return <Ctx value={{ environments, environment, select, isLoading }}>{children}</Ctx>;
}

export function useEnvironment(): EnvironmentContext {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useEnvironment outside EnvironmentProvider");
  return ctx;
}
