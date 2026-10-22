// Redacts secret-looking values before anything is written to the audit log or shown in the UI.

const REDACTED = "[redacted]";

const tokenPatterns: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const secretKey = /(pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential|auth)/i;

// KEY=value / "key": "value" / key: value where the key name looks secret.
const assignment =
  /(["']?)([A-Za-z0-9_.-]*(?:pass(?:word)?|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(["']?)([^\s"',}]+)\4/gi;

const bearer = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;

export function redactText(text: string): string {
  let out = text;
  for (const re of tokenPatterns) out = out.replace(re, REDACTED);
  out = out.replace(bearer, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  out = out.replace(assignment, (_m, q: string, key: string, sep: string, vq: string) => `${q}${key}${q}${sep}${vq}${REDACTED}${vq}`);
  return out;
}

export function redact<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = secretKey.test(k) && (typeof v === "string" || typeof v === "number") ? REDACTED : redact(v);
    }
    return out as T;
  }
  return value;
}
