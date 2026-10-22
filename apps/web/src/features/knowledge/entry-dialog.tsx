import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useEnvironment } from "@/hooks/use-environment";
import { useProject } from "@/hooks/use-project";
import { KNOWLEDGE_KINDS } from "@/lib/constants";
import { parseTags } from "@/lib/knowledge";
import { useAddKnowledge, useUpdateKnowledge } from "@/lib/queries";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/types";

const ENV_WIDE = "__env";

/** Add an entry (no `entry`) or edit one. Every edit bumps the entry's version on the server. */
export function EntryDialog({ entry, open, onOpenChange }: { entry?: KnowledgeEntry; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? <EntryForm entry={entry} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ entry, onDone }: { entry?: KnowledgeEntry; onDone: () => void }) {
  const { environment } = useEnvironment();
  const { projects } = useProject();
  const add = useAddKnowledge();
  const update = useUpdateKnowledge();
  const navigate = useNavigate();
  const [kind, setKind] = useState<KnowledgeKind>((entry?.kind as KnowledgeKind) ?? "convention");
  const [projectId, setProjectId] = useState<string>(entry?.projectId ?? ENV_WIDE);
  const [error, setError] = useState<string | null>(null);
  const pending = add.isPending || update.isPending;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const abstract = String(form.get("abstract") ?? "").trim();
    if (title.length < 3) return setError("The title needs at least 3 characters.");
    if (abstract.length < 3) return setError("The abstract needs at least 3 characters: it is what agents read first.");
    setError(null);
    const fields = {
      kind,
      title,
      abstract,
      body: String(form.get("body") ?? ""),
      area: String(form.get("area") ?? "").trim() || null,
      tags: parseTags(String(form.get("tags") ?? "")),
      projectId: projectId === ENV_WIDE ? null : projectId,
    };
    if (entry) {
      update.mutate(
        { id: entry.id, patch: fields },
        {
          onSuccess: (saved) => {
            onDone();
            toast.success(`Saved as v${saved.version}`);
          },
          onError: (err) => setError(err.message),
        },
      );
    } else {
      if (!environment) return setError("Pick an environment first.");
      add.mutate(
        { environmentId: environment.id, ...fields },
        {
          onSuccess: (saved) => {
            onDone();
            toast.success("Entry added", { action: { label: "Open", onClick: () => navigate(`/knowledge/${saved.id}`) } });
          },
          onError: (err) => setError(err.message),
        },
      );
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{entry ? "Edit entry" : "Add a knowledge entry"}</DialogTitle>
        <DialogDescription>
          {entry
            ? `Saving makes version ${entry.version + 1}. Agents read the title and abstract in every run; the body only when they ask.`
            : "Agents read the title and abstract in every run in this environment; the body only when they ask for it."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field>
            <FieldLabel htmlFor="kn-kind">Kind</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as KnowledgeKind)}>
              <SelectTrigger id="kn-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {KNOWLEDGE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="kn-title">Title</FieldLabel>
            <Input id="kn-title" name="title" defaultValue={entry?.title} autoComplete="off" autoFocus required minLength={3} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="kn-abstract">Abstract</FieldLabel>
          <Textarea id="kn-abstract" name="abstract" rows={2} defaultValue={entry?.abstract} required placeholder="One or two sentences an agent can act on." />
        </Field>
        <Field>
          <FieldLabel htmlFor="kn-body">Body</FieldLabel>
          <Textarea id="kn-body" name="body" rows={6} defaultValue={entry?.body} placeholder="Details, examples, links. Markdown is fine." />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="kn-project">Applies to</FieldLabel>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="kn-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ENV_WIDE}>The whole environment</SelectItem>
                </SelectGroup>
                {projects.length > 0 ? <SelectSeparator /> : null}
                <SelectGroup>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="kn-area">Area</FieldLabel>
            <Input id="kn-area" name="area" defaultValue={entry?.area ?? ""} placeholder="apps/web/" className="font-mono" autoComplete="off" />
            <FieldDescription>A path prefix; runs touching it see this entry first.</FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="kn-tags">Tags</FieldLabel>
          <Input id="kn-tags" name="tags" defaultValue={entry?.tags.join(", ")} placeholder="testing, ci" autoComplete="off" />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {entry ? `Save v${entry.version + 1}` : "Add entry"}
        </Button>
      </DialogFooter>
    </form>
  );
}
