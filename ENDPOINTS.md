# Lumina endpoints — authoring guide (for humans and AI)

**Audience:** anyone (including coding agents) asked to *create, change, or debug an endpoint that runs on a Lumina server*.

**This file is the canonical reference.** Follow it exactly. Do not invent frameworks, routers, or restart steps that Lumina does not use.

Related docs:

| File | Role |
|------|------|
| [`README.md`](./README.md) | How to run / deploy Lumina |
| [`agents.md`](./agents.md) | Changing Lumina’s own source code |
| **This file** | Programming site endpoints under `routes/` |

---

## What an endpoint is

On Lumina, an **endpoint** is a **JavaScript or TypeScript module file** placed under a domain’s **`routes/`** directory. Lumina:

1. Maps the **file path** → a **URL path**
2. Loads the module (dynamic `import`)
3. Calls your **exported handler** with a Web-standard `Request` (and optional path params)
4. Sends back your `Response`

No separate Node server, Express app, or rebuild of the Lumina Docker image is required for normal site endpoints.

**Hot reload:** creating, editing, or deleting a route file is picked up without restarting Lumina (when file watching is enabled, which is the default).

**Security:** files under `routes/` are **executed**, not served as downloadable source. Requests like `GET /routes/api.ts` return 404.

---

## Where to create the file (correct path)

### Domain content root

Each hostname maps to a **domain root** folder (from YAML `domains.<name>.root` under `LUMINA_DOMAINS_DIR`, or a git cache path).

Examples:

| Environment | Typical domain root for `example.com` |
|-------------|----------------------------------------|
| Docker | `/data/domains/example.com` (host folder mounted there) |
| Local examples | `examples/domains/example.com/` |

### Routes directory

Endpoints live under:

```text
<domain-root>/<routesDir>/
```

- Default `routesDir` is **`routes`**
- Override per domain in config: `routesDir: "api"` → files under `api/` instead

**Full path pattern:**

```text
<domain-root>/routes/<optional-subfolders>/<name>.ts
```

**Examples (domain root = `…/example.com`):**

| File path on disk | URL on that host |
|-------------------|------------------|
| `routes/health.ts` | `/health` |
| `routes/api.ts` | `/api` |
| `routes/time/index.ts` | `/time` |
| `routes/index.ts` | `/` |
| `routes/hello/[name].ts` | `/hello/:name` e.g. `/hello/world` |
| `routes/users/[id]/profile.ts` | `/users/:id/profile` e.g. `/users/42/profile` |
| `routes/docs/[...slug].ts` | `/docs/*` e.g. `/docs/a/b` → `slug = "a/b"` |
| `routes/blog/[[...slug]].ts` | optional catch-all under `/blog` |

### Checklist before writing code

1. Identify the **domain** (hostname) the endpoint must answer for.
2. Resolve that domain’s **content root** (from operator config / mount).
3. Ensure `routes/` exists under that root (create it if missing).
4. Choose a **file path** that maps to the desired URL (table above).
5. Create the file with a supported extension (below).
6. Export a handler as documented (below).
7. Request with correct **`Host`** (or alias) so Lumina selects that domain.

---

## Supported file types

| Extension | Supported |
|-----------|-----------|
| `.ts`, `.js`, `.tsx`, `.jsx`, `.mts`, `.mjs` | Yes |
| Other (e.g. `.json`, `.py`) | No — not loaded as routes |

Prefer **`.ts`** for new endpoints.

Do not start folder/file names with `.` (hidden segments are skipped / denied).

---

## File path → URL rules

1. Path is relative to `routes/`.
2. Extension is stripped.
3. A segment named `index` maps to the parent path (`routes/time/index.ts` → `/time`, `routes/index.ts` → `/`).
4. Static segments are literal URL segments (`users` → `/users`).
5. Dynamic segments:
   - `[param]` → one path segment → `params.param`
   - `[...param]` → catch-all remaining segments joined by `/` → `params.param`
   - `[[...param]]` → optional catch-all (same matching style; remaining may be empty)
6. URL matching is **case-sensitive** for static segments.
7. Dynamic path params are **URL-decoded** before being passed to the handler.
8. **Query string** is **not** part of the file name — read it from `request.url` in code.
9. **HTTP method** is **not** part of the file name — branch on `request.method` in code (or use separate files only if you want different paths).

### Precedence

- If multiple route files could match, **more specific** routes win (static segments score higher than dynamic; longer paths score higher).
- For a given request, **dynamic routes are tried before static files**.
- If a route matches, the handler runs even if a static file exists at the same path.

---

## What the file must export

Lumina looks for, in order:

1. `export default …`
2. else `export const app = …`
3. else `export const handler = …`
4. else `export const fetch = …`

### Recommended: default function

```ts
export default function handler(
  request: Request,
  params: Record<string, string>,
): Response | Promise<Response> {
  // ...
}
```

| Argument | Type | Meaning |
|----------|------|---------|
| `request` | [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) | Full HTTP request: method, URL, headers, body |
| `params` | `Record<string, string>` | Values from `[name]` / `[...slug]` in the **file path**. Empty object `{}` if none. |

**Return:** a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) (sync or async).

You may also return a plain value; Lumina will JSON-serialize it if it is not a `Response` (prefer explicit `Response.json` for clarity).

### Also accepted

- **Async function** — `export default async function …`
- **Hono app** — `export default new Hono()` or `export const app = new Hono()` (uses `.fetch`)
- **Object with `fetch(request)`** — same as a mini app

### Not required / do not use

- No `package.json` inside the domain for routes (unless the operator has a special setup)
- No Express `app.get(...)` registration into Lumina
- No exporting React components as pages (unless you return HTML `Response` yourself)
- Do not rely on Node-only globals that Bun does not provide unless you know the runtime

---

## Programming the handler

### Read method, path, query, headers

```ts
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const method = request.method; // "GET" | "POST" | …
  const pathname = url.pathname; // e.g. "/echo"
  const query = Object.fromEntries(url.searchParams.entries());
  const auth = request.headers.get("authorization");

  return Response.json({ method, pathname, query, auth });
}
```

### Path parameters

**File:** `routes/users/[id]/profile.ts`  
**Request:** `GET /users/42/profile`  
**Params:** `{ id: "42" }`

```ts
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  const id = params.id; // "42"
  if (!id) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }
  return Response.json({ userId: id, profile: true });
}
```

**Catch-all file:** `routes/docs/[...slug].ts`  
**Request:** `GET /docs/guide/install`  
**Params:** `{ slug: "guide/install" }`

```ts
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  const slug = params.slug ?? "";
  const parts = slug.length ? slug.split("/") : [];
  return Response.json({ slug, parts });
}
```

### JSON body (POST / PUT / PATCH)

```ts
export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  return Response.json({ received: body }, { status: 201 });
}
```

**Important:** you can read `request.body` / `.json()` / `.text()` **only once** unless you clone the request.

### Form body

```ts
export default async function handler(request: Request) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "");
  return Response.json({ name });
}
```

### Different HTTP methods in one file

```ts
export default async function handler(request: Request) {
  switch (request.method) {
    case "GET":
      return Response.json({ method: "GET" });
    case "POST": {
      const body = await request.json().catch(() => ({}));
      return Response.json({ method: "POST", body }, { status: 201 });
    }
    case "DELETE":
      return new Response(null, { status: 204 });
    default:
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "GET, POST, DELETE" } },
      );
  }
}
```

### Response helpers

```ts
// JSON
return Response.json({ ok: true }, { status: 200 });

// Text
return new Response("hello", {
  status: 200,
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});

// HTML
return new Response("<h1>Hi</h1>", {
  headers: { "Content-Type": "text/html; charset=utf-8" },
});

// Empty
return new Response(null, { status: 204 });

// Redirect
return Response.redirect(new URL("/other", request.url), 302);

// Custom headers
return Response.json(
  { ok: true },
  { headers: { "Cache-Control": "no-store" } },
);
```

### Errors

- Uncaught exceptions in the handler → Lumina logs and typically returns **500**.
- Prefer explicit status codes (`400`, `401`, `404`, `405`, `422`, …) in your own responses.
- Invalid modules / missing export → route is skipped (warning in server logs); client may get a normal 404 for that path.

### Async work

```ts
export default async function handler(request: Request) {
  const data = await fetch("https://httpbin.org/get").then((r) => r.json());
  return Response.json({ upstream: data });
}
```

Use timeouts and error handling for external calls in production.

### Environment / secrets

- Do **not** put secrets in route files that live in public git site repos if avoidable.
- Prefer environment variables available to the Lumina process, or server-side config outside the published site tree.
- Remember deny-list: `.env` is not served as static, but still do not commit secrets.

---

## Complete copy-paste templates

### A. Minimal health JSON — `routes/health.ts` → `/health`

```ts
export default function handler(_request: Request) {
  return Response.json({ status: "ok" });
}
```

### B. Dynamic segment — `routes/hello/[name].ts` → `/hello/:name`

```ts
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  return Response.json({
    hello: params.name ?? "anonymous",
  });
}
```

### C. Nested dynamic — `routes/users/[id]/profile.ts`

```ts
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  return Response.json({
    userId: params.id,
    profile: true,
  });
}
```

### D. Echo method, query, JSON body — `routes/echo.ts`

```ts
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  let body: unknown = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      body = await request.json().catch(() => ({ error: "invalid JSON" }));
    }
  }

  return Response.json({
    method: request.method,
    path: url.pathname,
    query,
    body,
  });
}
```

### E. Plain text folder index — `routes/time/index.ts` → `/time`

```ts
export default function handler(_request: Request) {
  return new Response(new Date().toISOString(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

Working samples ship under `examples/domains/example.com/routes/`.

---

## How to verify

Replace host and port as needed (`localhost` may be an alias of a domain in example config).

```bash
# Static check of mapping: file routes/health.ts → path /health
curl -sS -H "Host: example.com" http://127.0.0.1:3030/health

curl -sS -H "Host: example.com" http://127.0.0.1:3030/hello/lumina

curl -sS -H "Host: example.com" -X POST \
  -H "Content-Type: application/json" \
  -d '{"x":1}' \
  http://127.0.0.1:3030/echo
```

**Host matters:** wrong or unknown `Host` → HTML 404 “unknown host”, not your handler.

**Source not downloadable:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Host: example.com" http://127.0.0.1:3030/routes/health.ts
# expect 404
```

---

## AI agent playbook (when the user says “add an endpoint on Lumina”)

1. **Confirm domain root** — which site folder / hostname?
2. **Confirm URL** — e.g. `POST /api/orders`.
3. **Create file** under `<domain-root>/routes/…` following the mapping table (not under Lumina’s own `src/`).
4. **Implement** `export default` handler using Web `Request` / `Response`.
5. **Use `params`** only for `[segments]` in the file path; use `URL` / body for the rest.
6. **Do not** restart Docker for route edits if watching is on; do not rebuild the Lumina image for site endpoints.
7. **Do not** put the endpoint in `src/` of the Lumina server repo unless the user is changing Lumina core itself.
8. **Test** with `curl` and the correct `Host` header (or the real public hostname behind a proxy).
9. If something fails: check domain Host match, file path mapping, default export, and server logs.

---

## What is *not* a site endpoint

| Path / feature | Meaning |
|----------------|---------|
| `POST /_lumina/hooks/git` | Built-in git webhook (core server), not a `routes/` file |
| Files under Lumina `src/` | Server implementation, not customer site routes |
| Static `index.html` / assets | Served as files, not executed as handlers |
| `agents.md`, `.env`, `package.json` | Never served (deny list) |

---

## Config knobs (operators)

```yaml
domains:
  example.com:
    root: example.com          # folder under domains_dir
    routesDir: routes          # optional, default "routes"
    aliases:
      - www.example.com
```

Changing `routesDir` changes where you must place endpoint files for that domain.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Put a `.ts` / `.js` file under **`<domain-root>/routes/`** |
| 2 | Name folders/files so the path maps to the URL (`[id]`, `[...slug]`, `index`) |
| 3 | `export default function (request, params) { return Response… }` |
| 4 | Read method/query/body from `request`; path params from `params` |
| 5 | Save — hot reload applies; call with the right **Host** |

When in doubt, copy a template from this document or from `examples/domains/example.com/routes/`.
