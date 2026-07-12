async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Villa (${res.status})`);
  return data;
}

export const api = {
  get: (p) => req("GET", p),
  post: (p, b) => req("POST", p, b),
  patch: (p, b) => req("PATCH", p, b),
  put: (p, b) => req("PUT", p, b),
  del: (p) => req("DELETE", p),
};

export function roomSocketUrl(code, opts = {}) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = opts.host ? "?role=host" : opts.key ? `?key=${encodeURIComponent(opts.key)}` : "";
  return `${proto}//${location.host}/api/room/${code}/ws${params}`;
}
