import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { PageHeader, QueryError, RowsSkeleton } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { shortCommit } from "@/lib/format";
import { agentsQuery, skillsQuery } from "@/lib/queries";
import { cleanDescription, filterSkills, skillUsage } from "./skill-usage";

export function SkillsPage() {
  const skills = useQuery(skillsQuery);
  const agents = useQuery(agentsQuery);
  const [filter, setFilter] = useState("");
  const deferred = useDeferredValue(filter);
  const input = useRef<HTMLInputElement>(null);
  useHotkeys({ "/": () => input.current?.focus() });

  const usage = useMemo(() => skillUsage(agents.data ?? []), [agents.data]);
  const rows = useMemo(() => filterSkills(skills.data ?? [], deferred, usage), [skills.data, deferred, usage]);
  const missing = useMemo(() => {
    const known = new Set((skills.data ?? []).map((s) => s.name));
    return [...usage.keys()].filter((n) => !known.has(n)).toSorted();
  }, [skills.data, usage]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Skills"
        description="The pinned registry: vendored upstream skills with their source commit and licence, plus local ones."
        actions={
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={input}
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, source, agent"
              aria-label="Filter skills"
              className="w-72 pr-8 pl-8"
            />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-6 py-4">
        {missing.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Assigned but not in the registry</AlertTitle>
            <AlertDescription>
              {missing.join(", ")}. Agents run without these until they are added to the registry or removed from the agent.
            </AlertDescription>
          </Alert>
        ) : null}
        {skills.isError ? (
          <QueryError error={skills.error} what="skills" onRetry={() => void skills.refetch()} />
        ) : skills.isPending ? (
          <RowsSkeleton rows={8} />
        ) : skills.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">The registry is empty. Vendor skills with the repository's vendor script, or add local ones under skills/local.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Used by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No skill matches “{deferred}”.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.name} className="align-top">
                    <TableCell className="max-w-md whitespace-normal">
                      <p className="font-medium">{s.name}</p>
                      {s.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{cleanDescription(s.description)}</p> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.origin === "local" ? "default" : "secondary"}>{s.origin}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.source ?? "this repository"}
                      {s.commit ? (
                        <span className="text-muted-foreground" title={s.commit}>
                          {" "}
                          @{shortCommit(s.commit)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{s.license ?? "unrecorded"}</TableCell>
                    <TableCell>
                      {(usage.get(s.name) ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">No agent</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {usage.get(s.name)!.map((a) => (
                            <Badge key={a} variant="outline">
                              {a}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
