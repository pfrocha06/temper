import { useQuery } from "@tanstack/react-query";
import { PencilIcon, ShieldAlertIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { providersQuery, skillsQuery, toolsQuery, useSaveAgent } from "@/lib/queries";
import type { Agent } from "@/lib/types";
import { toAgentEdit, toFormValues, type AgentFormValues, type FormErrors } from "./agent-form";

/** Assigned skills and servers must read as selected at a glance, in both themes. */
const PRESSED = "data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground";

export function AgentEditDialog({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? <AgentForm agent={agent} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AgentForm({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const save = useSaveAgent();
  const skills = useQuery(skillsQuery);
  const tools = useQuery(toolsQuery);
  const providers = useQuery(providersQuery);
  const [values, setValues] = useState<AgentFormValues>(() => toFormValues(agent));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const isVerifier = agent.role === "verifier";

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggleSkill = (name: string, on: boolean) =>
    setValues((v) => ({ ...v, skills: on ? [...v.skills, name] : v.skills.filter((s) => s !== name) }));

  const toggleMcp = (name: string, on: boolean) =>
    setValues((v) => ({ ...v, mcpServers: on ? [...v.mcpServers, name] : v.mcpServers.filter((s) => s !== name) }));
  const mcpKnown = tools.data?.mcpServers.map((m) => m.name) ?? [];
  const mcpUnknown = values.mcpServers.filter((s) => !mcpKnown.includes(s));
  const mcpDescription = new Map(tools.data?.mcpServers.map((m) => [m.name, m.description]) ?? []);

  // Adapters the server can dispatch to, plus the current one so it always shows.
  const adapters = [...new Set([agent.adapter, ...(providers.data ?? []).filter((p) => p.adapter && p.enabled !== false).map((p) => p.id)])];
  const adapterName = new Map(providers.data?.map((p) => [p.id, p.name]) ?? []);
  // Model names belong to one vendor: switching adapter falls back to its default model.
  const setAdapter = (adapter: string) => setValues((v) => ({ ...v, adapter, model: adapter === agent.adapter ? (agent.model ?? "") : "" }));

  const known = skills.data?.map((s) => s.name) ?? [];
  const unknownAssigned = values.skills.filter((s) => !known.includes(s));
  const skillNames = [...known, ...unknownAssigned].toSorted();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { edit, errors } = toAgentEdit(values);
    setErrors(errors);
    if (!edit) return;
    setServerError(null);
    save.mutate(
      { id: agent.id, edit },
      {
        onSuccess: (saved) => {
          onDone();
          toast.success(isVerifier ? `Verifier v${saved.version} saved; approve it in the Inbox to put it to work` : `${saved.name} saved as v${saved.version}`);
        },
        onError: (err) => setServerError(err.message),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Edit {agent.name}</DialogTitle>
        <DialogDescription>
          Saving creates version {agent.version + 1}. Running dispatches keep the version they started with.
        </DialogDescription>
      </DialogHeader>
      {isVerifier ? (
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>Verifier changes need board approval</AlertTitle>
          <AlertDescription>The Verifier decides what counts as proof. The new version waits in the Inbox; until you approve it, the last approved version keeps running.</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="ag-name">Name</FieldLabel>
            <Input id="ag-name" value={values.name} onChange={(e) => set("name", e.target.value)} aria-invalid={errors.name ? true : undefined} />
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="ag-adapter">Adapter</FieldLabel>
            <Select value={values.adapter} onValueChange={setAdapter}>
              <SelectTrigger id="ag-adapter" className="w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {adapters.map((id) => (
                  <SelectItem key={id} value={id} className="font-mono">
                    {id}
                    {adapterName.get(id) ? <span className="font-sans text-muted-foreground">{adapterName.get(id)}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Only adapters the profile enables are listed.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ag-model">Model</FieldLabel>
            <Input id="ag-model" value={values.model} onChange={(e) => set("model", e.target.value)} placeholder="Adapter default" className="font-mono" />
          </Field>
          <Field data-invalid={errors.maxConcurrency ? true : undefined}>
            <FieldLabel htmlFor="ag-conc">Concurrent runs</FieldLabel>
            <Input
              id="ag-conc"
              inputMode="numeric"
              value={values.maxConcurrency}
              onChange={(e) => set("maxConcurrency", e.target.value)}
              aria-invalid={errors.maxConcurrency ? true : undefined}
            />
            <FieldDescription>0 stops this agent from being dispatched.</FieldDescription>
            {errors.maxConcurrency ? <FieldError>{errors.maxConcurrency}</FieldError> : null}
          </Field>
          <Field data-invalid={errors.runsPerHour ? true : undefined}>
            <FieldLabel htmlFor="ag-rate">Runs per hour</FieldLabel>
            <Input
              id="ag-rate"
              inputMode="numeric"
              value={values.runsPerHour}
              onChange={(e) => set("runsPerHour", e.target.value)}
              aria-invalid={errors.runsPerHour ? true : undefined}
            />
            {errors.runsPerHour ? <FieldError>{errors.runsPerHour}</FieldError> : null}
          </Field>
        </div>
        <FieldSet>
          <FieldLegend variant="label">Skills</FieldLegend>
          <FieldDescription>Only these skills are loaded into this agent's runs.</FieldDescription>
          {skills.isPending ? (
            <Spinner />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {skillNames.map((name) => (
                <Toggle
                  key={name}
                  size="sm"
                  variant="outline"
                  pressed={values.skills.includes(name)}
                  onPressedChange={(on) => toggleSkill(name, on)}
                  className={cn("h-6 px-2 text-xs", PRESSED)}
                  title={unknownAssigned.includes(name) ? "Not in the skill registry" : undefined}
                >
                  {name}
                </Toggle>
              ))}
            </div>
          )}
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">MCP servers</FieldLegend>
          <FieldDescription>
            Runs of this agent get only these servers. Add servers in <code className="font-mono">~/.temper/profile.json</code>; see Tools.
          </FieldDescription>
          {tools.isPending ? (
            <Spinner />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[...mcpKnown, ...mcpUnknown].map((name) => (
                <Toggle
                  key={name}
                  size="sm"
                  variant="outline"
                  pressed={values.mcpServers.includes(name)}
                  onPressedChange={(on) => toggleMcp(name, on)}
                  className={cn("h-6 px-2 font-mono text-xs", PRESSED)}
                  title={mcpUnknown.includes(name) ? "Not in the profile: runs skip it" : mcpDescription.get(name) || undefined}
                >
                  {name}
                </Toggle>
              ))}
            </div>
          )}
        </FieldSet>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ag-allow">Allowed tools</FieldLabel>
            <Textarea id="ag-allow" rows={5} className="font-mono text-xs" value={values.allowedTools} onChange={(e) => set("allowedTools", e.target.value)} />
            <FieldDescription>One per line, e.g. Bash(git diff:*).</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ag-deny">Disallowed tools</FieldLabel>
            <Textarea id="ag-deny" rows={5} className="font-mono text-xs" value={values.disallowedTools} onChange={(e) => set("disallowedTools", e.target.value)} />
            <FieldDescription>Takes precedence over allowed tools.</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="ag-instr">Instructions</FieldLabel>
          <Textarea id="ag-instr" rows={5} value={values.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Appended to every run of this agent." />
        </Field>
        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save v{agent.version + 1}
        </Button>
      </DialogFooter>
    </form>
  );
}
