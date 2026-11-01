// HTTP calls to the candidate app. The body is parsed as JSON when it is JSON.
export async function request(url, path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, body, text };
}

export const get = (url, path, init) => request(url, path, { ...init, method: "GET" });
export const post = (url, path, data, init) => request(url, path, { ...init, method: "POST", body: JSON.stringify(data) });
