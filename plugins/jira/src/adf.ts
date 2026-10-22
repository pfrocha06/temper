// Atlassian Document Format → Markdown. Unknown nodes fall back to their text content.
export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
};

function applyMarks(text: string, marks: AdfNode["marks"]): string {
  let out = text;
  for (const m of marks ?? []) {
    if (m.type === "code") out = `\`${out}\``;
    else if (m.type === "strong") out = `**${out}**`;
    else if (m.type === "em") out = `*${out}*`;
    else if (m.type === "strike") out = `~~${out}~~`;
    else if (m.type === "link") out = `[${out}](${String(m.attrs?.href ?? "")})`;
  }
  return out;
}

const inline = (nodes: AdfNode[] = []): string => nodes.map(inlineNode).join("");

function inlineNode(n: AdfNode): string {
  switch (n.type) {
    case "text":
      return applyMarks(n.text ?? "", n.marks);
    case "hardBreak":
      return "\n";
    case "mention":
      return String(n.attrs?.text ?? "");
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    case "inlineCard":
      return String(n.attrs?.url ?? "");
    default:
      return n.content ? inline(n.content) : (n.text ?? "");
  }
}

const indent = (s: string, pad: string) =>
  s
    .split("\n")
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join("\n");

function list(n: AdfNode, ordered: boolean): string {
  const start = Number(n.attrs?.order ?? 1);
  return (n.content ?? [])
    .map((item, i) => {
      const marker = ordered ? `${start + i}. ` : "- ";
      const body = (item.content ?? [])
        .map(block)
        .filter((x) => x !== "")
        .join("\n")
        .trim();
      return marker + indent(body, " ".repeat(marker.length));
    })
    .join("\n");
}

function table(n: AdfNode): string {
  const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => blocks(c.content ?? []).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [pad(rows[0]!), pad(Array(width).fill("---")), ...rows.slice(1).map(pad)].join("\n");
}

function block(n: AdfNode): string {
  switch (n.type) {
    case "paragraph":
      return inline(n.content);
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))))} ${inline(n.content)}`;
    case "bulletList":
      return list(n, false);
    case "orderedList":
      return list(n, true);
    case "codeBlock":
      return "```" + String(n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    case "blockquote":
      return blocks(n.content ?? [])
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
    case "rule":
      return "---";
    case "table":
      return table(n);
    case "panel":
    case "expand":
      return blocks(n.content ?? []);
    default:
      return n.content ? blocks(n.content) : inlineNode(n);
  }
}

function blocks(nodes: AdfNode[]): string {
  return nodes
    .map(block)
    .filter((s) => s !== "")
    .join("\n\n");
}

/** Converts an ADF document (or plain string, as older Jira payloads carry) to Markdown. */
export function adfToMarkdown(doc: unknown): string {
  if (doc == null) return "";
  if (typeof doc === "string") return doc.trim();
  const root = doc as AdfNode;
  return (root.type === "doc" ? blocks(root.content ?? []) : block(root)).trim();
}

/** Wraps plain text as a minimal ADF document, one paragraph per blank-line-separated block. */
export function textToAdf(text: string): AdfNode {
  const paras = text.split(/\n{2,}/).filter((p) => p.trim());
  return {
    type: "doc",
    content: paras.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), { type: "text", text: line }]),
    })),
  };
}
