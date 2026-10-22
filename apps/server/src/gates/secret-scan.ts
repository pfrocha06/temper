import { redactText } from "@temper/core";

/** Fallback scan when gitleaks is unavailable: any added diff line our redactor would change. */
export function scanAddedLines(diffText: string): string[] {
  const hits: string[] = [];
  let file = "";
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(6);
    else if (line.startsWith("+") && redactText(line) !== line) hits.push(`${file}: possible secret`);
  }
  return [...new Set(hits)];
}
