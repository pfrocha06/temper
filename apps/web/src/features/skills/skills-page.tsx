import { useQuery } from "@tanstack/react-query";
import { GitCommitHorizontalIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { RoleAvatar, roleMeta } from "@/components/role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { shortCommit } from "@/lib/format";
import { agentsQuery, skillsQuery } from "@/lib/queries";
import type { SkillEntry } from "@/lib/types";
import { cleanDescription, filterSkills, groupBySource, skillRoles, skillUsage, sourceOf } from "./skill-usage";

const ROLES = ["chief", "builder", "verifier", "reviewer"];
const UNUSED = "unused";

export function SkillsPage() {
  const skills = useQuery(skillsQuery);
  const agents = useQuery(agentsQuery);
  const [filter, setFilter] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const deferred = useDeferredValue(filter);
  const input = useRef<HTMLInputElement>(null);
  useHotkeys({ "/": () => input.current?.focus() });

  const usage = useMemo(() => skillUsage(agents.data ?? []), [agents.data]);
  const byRole = useMemo(() => skillRoles(agents.data ?? []), [agents.data]);
  const allSources = useMemo(() => groupBySource(skills.data ?? []).map((g) => ({ source: g.source, count: g.skills.length })), [skills.data]);
  const groups = useMemo(() => {
    const rows = filterSkills(skills.data ?? [], deferred, usage).filter((s) => {
      if (sources.length > 0 && !sources.includes(sourceOf(s))) return false;
      if (roles.length === 0) return true;
      const r = byRole.get(s.name) ?? [];
      return roles.some((x) => (x === UNUSED ? r.length === 0 : r.includes(x)));
    });
    return groupBySource(rows);
  }, [skills.data, deferred, usage, sources, roles, byRole]);
  const shown = groups.reduce((n, g) => n + g.skills.length, 0);
  const missing = useMemo(() => {
    const known = new Set((skills.data ?? []).map((s) => s.name));
    return [...usage.keys()].filter((n) => !known.has(n)).toSorted();
  }, [skills.data, usage]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Skills"
        info="The pinned registry: vendored upstream skills with their source commit and licence, plus local ones. Agents load only the skills assigned to them."
        meta={
          skills.data ? <span className="tabular-nums">{shown === skills.data.length ? `${shown} skills` : `${shown} of ${skills.data.length}`}</span> : null
        }
        actions={
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={input}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter skills"
              aria-label="Filter skills by name, description, source or agent"
              className="w-56 pr-8 pl-8 md:w-72"
            />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToggleGroup type="multiple" variant="outline" size="sm" value={roles} onValueChange={setRoles} aria-label="Filter by agent" className="flex-wrap">
            {ROLES.map((r) => (
              <ToggleGroupItem key={r} value={r} aria-label={`Used by ${roleMeta(r).label}`} className="gap-1.5">
                <RoleAvatar role={r} size="xs" tooltip={false} />
                {roleMeta(r).label}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value={UNUSED}>No agent</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={sources}
            onValueChange={setSources}
            aria-label="Filter by source"
            className="flex-wrap"
          >
            {allSources.map((s) => (
              <ToggleGroupItem key={s.source} value={s.source} className="font-mono text-xs">
                {s.source}
                <span className="font-sans text-muted-foreground tabular-nums">{s.count}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {missing.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Assigned but not in the registry</AlertTitle>
            <AlertDescription>{missing.join(", ")}. Agents run without these until they are added to the registry or removed from the agent.</AlertDescription>
          </Alert>
        ) : null}
        {skills.isError ? (
          <QueryError error={skills.error} what="skills" onRetry={() => void skills.refetch()} />
        ) : skills.isPending ? (
          <RowsSkeleton rows={8} />
        ) : skills.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The registry is empty. Vendor skills with the repository's vendor script, or add local ones under skills/local.
          </p>
        ) : shown === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No skill matches these filters.</p>
        ) : (
          groups.map((g) => {
            const shared = sharedMeta(g.skills);
            return (
              <section key={g.source} aria-labelledby={`src-${g.source}`} className="flex flex-col gap-2">
                <h2 id={`src-${g.source}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm font-semibold">
                  <span className="font-mono">{g.source}</span>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">{g.skills.length}</span>
                  {shared ? <Meta commit={shared.commit} license={shared.license} /> : null}
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {g.skills.map((s) => (
                    <li key={s.name} className="min-w-0">
                      <SkillCard skill={s} roles={byRole.get(s.name) ?? []} showMeta={!shared} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The commit and licence every skill of a group shares, if they all agree. */
function sharedMeta(skills: SkillEntry[]): { commit?: string; license?: string } | undefined {
  const first = skills[0];
  if (!first || skills.some((s) => s.commit !== first.commit || s.license !== first.license)) return undefined;
  return { commit: first.commit, license: first.license };
}

function Meta({ commit, license }: { commit?: string; license?: string }) {
  return (
    <span className="inline-flex items-center gap-3 text-xs font-normal text-muted-foreground">
      {commit ? (
        <span className="inline-flex items-center gap-1 font-mono" title={commit}>
          <GitCommitHorizontalIcon aria-hidden className="size-3.5" />
          {shortCommit(commit)}
        </span>
      ) : null}
      <span>{license ?? "licence unrecorded"}</span>
    </span>
  );
}

function SkillCard({ skill, roles, showMeta }: { skill: SkillEntry; roles: string[]; showMeta: boolean }) {
  const description = cleanDescription(skill.description);
  return (
    <article className={cn("flex h-full flex-col gap-2 rounded-lg border bg-card p-3", roles.length === 0 && "border-dashed bg-transparent")}>
      <header className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={skill.name}>
          {skill.name}
        </h3>
        {roles.length > 0 ? (
          <span className="flex -space-x-1" aria-label={`Used by ${roles.map((r) => roleMeta(r).label).join(", ")}`}>
            {roles.map((r) => (
              <RoleAvatar key={r} role={r} size="xs" className="ring-2 ring-card" />
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no agent</span>
        )}
      </header>
      {description ? (
        <p className="line-clamp-3 text-xs leading-5 text-muted-foreground" title={description}>
          {description}
        </p>
      ) : null}
      {showMeta ? (
        <footer className="mt-auto pt-1">
          <Meta commit={skill.commit} license={skill.license ?? (skill.origin === "local" ? "local" : undefined)} />
        </footer>
      ) : null}
    </article>
  );
}
