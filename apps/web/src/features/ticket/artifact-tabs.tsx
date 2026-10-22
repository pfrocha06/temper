import { Markdown } from "@/components/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/lib/format";
import type { Artifact } from "@/lib/types";

/** Stage outputs in workflow order where known, the rest alphabetically. */
const ORDER = ["spec.md", "changes.md", "verification.md", "review.md"];
const rank = (name: string) => {
  const i = ORDER.indexOf(name);
  return i === -1 ? ORDER.length : i;
};

export function ArtifactTabs({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <p className="text-sm text-muted-foreground">No artifacts yet. Each stage writes its artifact here when it finishes.</p>;
  }
  const sorted = artifacts.toSorted((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  return (
    <Tabs defaultValue={sorted[0]!.name}>
      <TabsList variant="line" className="flex-wrap">
        {sorted.map((a) => (
          <TabsTrigger key={a.name} value={a.name} className="font-mono text-xs">
            {a.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {sorted.map((a) => (
        <TabsContent key={a.name} value={a.name} className="pt-3">
          <p className="mb-3 text-xs text-muted-foreground">Updated {relativeTime(a.createdAt)}</p>
          <Markdown>{a.content}</Markdown>
        </TabsContent>
      ))}
    </Tabs>
  );
}
