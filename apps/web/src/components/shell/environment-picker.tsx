import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAppActions } from "@/hooks/use-app-actions";
import { useEnvironment } from "@/hooks/use-environment";
import { useCreateEnvironment } from "@/lib/queries";

const NEW = "__new";

/** The environment the Chief, knowledge and the project list are scoped to; also where a new one starts. */
export function EnvironmentPicker() {
  const { environments, environment, select } = useEnvironment();
  const { show } = useAppActions();
  if (!environment) return null;
  return (
    <Select value={environment.id} onValueChange={(v) => (v === NEW ? show("new-environment") : select(v))}>
      <SelectTrigger size="sm" aria-label="Environment" className="max-w-48 min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {environments.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectItem value={NEW}>
            <PlusIcon />
            New environment
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function NewEnvironmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateEnvironment();
  const { select } = useEnvironment();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const rootPath = String(form.get("rootPath") ?? "").trim();
    if (!name || !rootPath) return setError("Both a name and a root folder are needed.");
    setError(null);
    create.mutate(
      { name, rootPath },
      {
        onSuccess: (env) => {
          select(env.id);
          onOpenChange(false);
          toast.success(`Switched to ${env.name}`);
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New environment</DialogTitle>
            <DialogDescription>A group of projects that share knowledge and a Chief of Staff, e.g. one per client or workspace.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="env-name">Name</FieldLabel>
              <Input id="env-name" name="name" autoComplete="off" autoFocus required />
            </Field>
            <Field>
              <FieldLabel htmlFor="env-root">Root folder</FieldLabel>
              <Input id="env-root" name="rootPath" autoComplete="off" required placeholder="/Users/you/work/acme" className="font-mono" />
              <FieldDescription>Where the Chief works from in conversations; usually the folder holding the projects.</FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
