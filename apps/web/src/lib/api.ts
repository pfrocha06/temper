import { setAuthRequired } from "./auth";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True when the server could not be reached at all (as opposed to answering with an error). */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && (err.status === 502 || err.status === 503 || err.status === 504));
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init?.signal,
  });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.status === 401) setAuthRequired(true);
  else if (res.ok) setAuthRequired(false);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
