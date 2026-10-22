import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProject } from "@/hooks/use-project";

/** Only shown when there is a choice to make. */
export function ProjectPicker() {
  const { projects, project, select } = useProject();
  if (projects.length < 2 || !project) {
    return project ? <span className="text-sm font-medium">{project.name}</span> : null;
  }
  return (
    <Select value={project.id} onValueChange={select}>
      <SelectTrigger size="sm" aria-label="Project" className="min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
