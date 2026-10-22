import { SlidersHorizontalIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { capsToForm, formToCaps, type CapField, type CapsForm, type ProviderInfo } from "@/lib/providers";
import { useSetCaps } from "@/lib/queries";

const ROWS: Array<{ label: string; runs: CapField; tokens: CapField }> = [
  { label: "Per session", runs: "runsPerSession", tokens: "tokensPerSession" },
  { label: "Per day", runs: "runsPerDay", tokens: "tokensPerDay" },
  { label: "Per week", runs: "runsPerWeek", tokens: "tokensPerWeek" },
];

export function CapsDialog({ provider }: { provider: ProviderInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontalIcon data-icon="inline-start" />
          Caps
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">{open ? <CapsForm provider={provider} onDone={() => setOpen(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function CapsForm({ provider, onDone }: { provider: ProviderInfo; onDone: () => void }) {
  const save = useSetCaps();
  const [values, setValues] = useState<CapsForm>(() => capsToForm(provider.caps));
  const [errors, setErrors] = useState<Partial<Record<CapField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (field: CapField, value: string) => setValues((v) => ({ ...v, [field]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { caps, errors } = formToCaps(values);
    setErrors(errors);
    if (!caps) return;
    setServerError(null);
    save.mutate(
      { id: provider.id, caps },
      {
        onSuccess: () => {
          onDone();
          toast.success(`${provider.name} caps saved`);
        },
        onError: (err) => setServerError(err.message),
      },
    );
  };

  const input = (field: CapField, label: string, placeholder = "No cap") => (
    <Field data-invalid={errors[field] ? true : undefined}>
      <FieldLabel htmlFor={`cap-${field}`} className="sr-only">
        {label}
      </FieldLabel>
      <Input
        id={`cap-${field}`}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={values[field]}
        onChange={(e) => set(field, e.target.value)}
        aria-invalid={errors[field] ? true : undefined}
        className="tabular-nums"
      />
      {errors[field] ? <FieldError>{errors[field]}</FieldError> : null}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{provider.name} caps</DialogTitle>
        <DialogDescription>
          Limits Temper keeps on its own use of this provider. When one is reached, new work for it waits until the window resets and the Inbox gets a notice. Leave a field empty for no cap.
        </DialogDescription>
      </DialogHeader>

      <table className="w-full border-separate border-spacing-x-2 border-spacing-y-1.5 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="font-normal">
              <span className="sr-only">Window</span>
            </th>
            <th scope="col" className="font-normal">
              Runs
            </th>
            <th scope="col" className="font-normal">
              Tokens
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className="align-top">
              <th scope="row" className="pt-2 pr-1 text-left font-medium whitespace-nowrap">
                {r.label}
              </th>
              <td>{input(r.runs, `Runs ${r.label.toLowerCase()}`)}</td>
              <td>{input(r.tokens, `Tokens ${r.label.toLowerCase()}`, "No cap, e.g. 2M")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Field data-invalid={errors.sessionHours ? true : undefined} className="max-w-xs">
        <FieldLabel htmlFor="cap-sessionHours">Session window</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="cap-sessionHours"
            inputMode="numeric"
            autoComplete="off"
            placeholder="5"
            value={values.sessionHours}
            onChange={(e) => set("sessionHours", e.target.value)}
            aria-invalid={errors.sessionHours ? true : undefined}
            aria-describedby="cap-sessionHours-desc"
            className="w-20 tabular-nums"
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
        <FieldDescription id="cap-sessionHours-desc">A rolling window of 1–24 hours; 5 when empty.</FieldDescription>
        {errors.sessionHours ? <FieldError>{errors.sessionHours}</FieldError> : null}
      </Field>

      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>Could not save: {serverError}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save caps
        </Button>
      </DialogFooter>
    </form>
  );
}
