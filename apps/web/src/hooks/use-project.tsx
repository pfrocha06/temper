import { useQuery } from "@tanstack/react-query";
import { createContext, use, useState, type ReactNode } from "react";
import { projectsQuery } from "@/lib/queries";
import type { Project } from "@/lib/types";

type ProjectContext = {
  projects: Project[];
  /** The selected project, or the only one; undefined when there are none. */
  project: Project | undefined;
  select: (id: string) => void;
  isLoading: boolean;
};

const Ctx = createContext<ProjectContext | null>(null);
const STORAGE_KEY = "temper.project";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [], isLoading } = useQuery(projectsQuery);
  const [selectedId, setSelectedId] = useState<string | null>(readStored);
  const project = projects.find((p) => p.id === selectedId) ?? projects[0];

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Selection still applies for this session.
    }
  };

  return <Ctx value={{ projects, project, select, isLoading }}>{children}</Ctx>;
}

export function useProject(): ProjectContext {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useProject outside ProjectProvider");
  return ctx;
}
