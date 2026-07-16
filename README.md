# Lumina

[![CI](https://github.com/lubino/lumina/actions/workflows/ci.yml/badge.svg)](https://github.com/lubino/lumina/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/lubino/lumina?include_prereleases&sort=semver)](https://github.com/lubino/lumina/releases)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2Flubino%2Flumina-blue?logo=docker&logoColor=white)](https://github.com/lubino/lumina/pkgs/container/lumina)
[![Version](https://img.shields.io/github/package-json/v/lubino/lumina)](./package.json)

**A multi-domain web server that serves static content and JavaScript/TypeScript endpoints — with changes applied immediately, without restarting the server.**

Lumina is meant to be used as a **ready Docker image**: you mount configuration and site folders, start the stack, and host many websites from one process. You do not rebuild or reinstall the server when you edit a page or an API route.

## Project status

| Item | Where |
|------|--------|
| **CI / tests** | [GitHub Actions — CI](https://github.com/lubino/lumina/actions/workflows/ci.yml) (badge above; runs on every push/PR to `main`) |
| **Coverage** | Generated in CI via `bun test --coverage`; download the **coverage-report** artifact from a workflow run. Locally: `bun run test:coverage` |
| **Container image** | [`ghcr.io/lubino/lumina`](https://github.com/lubino/lumina/pkgs/container/lumina) — tags `latest` (main), `sha-…`, and semver when you push tags `v*`. **Multi-arch:** `linux/amd64` + `linux/arm64` (Raspberry Pi, etc.) |
| **Source / issues** | [github.com/lubino/lumina](https://github.com/lubino/lumina) |
| **License** | [AGPL-3.0-only](./LICENSE) |

```bash
# Pull the published image (package must be public, or docker login ghcr.io)
docker pull ghcr.io/lubino/lumina:latest
```

> **Note:** GHCR packages are often **private** until you set the package visibility to public under GitHub → Packages → `lumina` → Package settings. Until the first successful CI publish, the package page may not exist yet.

### Why Lumina

| Need | What Lumina does |
|------|------------------|
| **Static sites** | Serves HTML, CSS, images, and other files from each domain’s folder — drop files in, they are live. |
| **JS / TS endpoints** | Files under `routes/` become HTTP endpoints (JSON APIs, dynamic responses, etc.) without a separate app server. |
| **Instant updates** | Change a static file **or** a route script: the next request already uses the new content. **No server restart**, no rebuild of the Lumina image. |
| **Many domains** | One process, many hostnames (`Host` header); aliases can share one folder. |
| **Simple ops** | Config is YAML; production path is pull image → mount volumes → run. |

In short: it feels like classic static + script hosting (think “files on disk become the site”), but with modern **TypeScript/JavaScript** handlers and **zero-restart** reloads for both assets and endpoints.

If you want to **host websites**, this file is for you.  
If you want to **create or program HTTP endpoints** (JS/TS under `routes/`), see **[`ENDPOINTS.md`](./ENDPOINTS.md)** — full path mapping, handler API, and templates (for humans and AI agents).  
If you want to **change the server itself**, see [`agents.md`](./agents.md).

---

## What you get

- **Static content + dynamic routes** — HTML/CSS/assets next to optional `routes/*.ts` / `routes/*.js` endpoints  
- **Hot reload without restart** — edit static files, route modules, or `config.yaml`; changes show up on the next request  
- **Many domains on one process** — `example.com`, `www.example.com`, `blog.example.com`, …  
- **Aliases** — several hostnames can share the same folder  
- **Optional Git sites** — a domain can be a git clone that Lumina keeps updated  
- **Safe defaults** — secrets, `.git`, `node_modules`, `package.json`, agent docs, and similar paths are **not** exposed over HTTP  
- **Reverse-proxy friendly** — nginx, HAProxy, Caddy, Traefik, cloudflared, and similar; uses forwarded host headers for virtual hosting  

You do **not** need Node/Bun on the server for normal use. Pull the image, mount config + sites, start the stack.

---

## Quick start (Docker)

### 1. Prepare folders on the host

```text
config/
└── config.yaml
sites/
└── example.com/
    ├── index.html
    └── assets/
        └── style.css
```

### 2. Minimal `config.yaml`

```yaml
paths:
  domains_dir: /data/domains
  git_cache_dir: /data/git-cache

domains:
  example.com:
    root: example.com          # folder under /data/domains
    aliases:
      - www.example.com
    git:
      enabled: false
```

### 3. Compose stack

```yaml
services:
  lumina:
    image: lumina:latest       # use your registry tag / digest in production
    ports:
      - "3030:3030"            # host:container — container listens on LUMINA_PORT
    environment:
      LUMINA_PORT: "3030"      # optional; default is already 3030
      LUMINA_CONFIG: /config/config.yaml
      LUMINA_DOMAINS_DIR: /data/domains
      LUMINA_GIT_CACHE_DIR: /data/git-cache
    volumes:
      # Point these at your own folders (names/paths are up to you)
      - /path/to/your-lumina-data/config:/config:ro
      - /path/to/your-lumina-data/sites:/data/domains:ro
      - lumina-git-cache:/data/git-cache
    restart: unless-stopped

volumes:
  lumina-git-cache:
```

```bash
docker compose up -d
# open http://localhost:3030/ with Host: example.com
# or point DNS / reverse proxy at the service
```

**Nothing is compiled or installed when the stack starts.** The image is already built. You only mount configuration and content.

> Until a published image is available on a registry, build once on a build machine:  
> `docker build -t lumina:latest .`  
> then use that tag in the stack (still no build on the *runtime* host if you ship the image).

---

## How sites work

| Request host | Where content comes from |
|--------------|---------------------------|
| Primary domain name in config | That domain’s `root` folder (or git cache) |
| Alias listed under the domain | Same folder as the primary domain |
| Unknown host | `404` |

### Local files

Put a directory per site under the domains mount (default `/data/domains`):

```text
sites/
├── example.com/
│   ├── index.html          → https://example.com/
│   ├── about.html          → https://example.com/about.html
│   ├── assets/app.css      → https://example.com/assets/app.css
│   └── routes/             → optional dynamic endpoints (see below)
└── blog.example.com/
    └── index.html
```

In config, `root: example.com` means `/data/domains/example.com`. You can also use an absolute path.

### Dynamic routes (endpoints)

You create endpoints by adding **files** under the domain’s `routes/` folder. Lumina maps the file path to a URL, runs your handler, and hot-reloads on change (no process restart).

| File under `routes/` | URL |
|----------------------|-----|
| `health.ts` | `/health` |
| `hello/[name].ts` | `/hello/world` |
| `users/[id]/profile.ts` | `/users/42/profile` |

```ts
// routes/health.ts
export default function handler(_request: Request) {
  return Response.json({ status: "ok" });
}
```

**Full specification for humans and AI agents** (exact paths, params, methods, body, templates, checklist):

### → **[`ENDPOINTS.md`](./ENDPOINTS.md)**

Examples also live under `examples/domains/example.com/routes/`.

### Git-backed domain

```yaml
domains:
  docs.example.com:
    git:
      enabled: true
      url: "https://git.example.com/org/docs.git"
      branch: "main"
      path: "public"    # optional subfolder inside the repo
```

On start / config reload Lumina clones or pulls into the git cache volume, then serves that tree. The **server image** is still prebuilt; only **site** content is fetched from git.

---

## Configuration reference

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LUMINA_PORT` | **`3030`** | Listen port (**env only** — not in YAML) |
| `LUMINA_HOST` | **`0.0.0.0`** | Bind address (**env only** — not in YAML) |
| `LUMINA_CONFIG` | `/config/config.yaml` | Path to the YAML file |
| `LUMINA_DOMAINS_DIR` | `/data/domains` | Base directory for relative `root` values |
| `LUMINA_GIT_CACHE_DIR` | `/data/git-cache` | Where git sites are cloned |
| `LUMINA_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LUMINA_WATCH` | on | Set to `0` to disable file/config watching |
| `LUMINA_SYNC_GIT` | on | Set to `0` to skip git clone/pull on start |

**Listen settings:** host and port are configured **only** via environment variables. There is no `server:` section in YAML (if present, config load fails).

### YAML shape

```yaml
# No server: block — use LUMINA_HOST / LUMINA_PORT for listening.

paths:
  domains_dir: /data/domains
  git_cache_dir: /data/git-cache

domains:
  example.com:
    root: example.com              # relative to domains_dir, or absolute
    aliases:
      - www.example.com
    routesDir: routes              # optional, default "routes"
    git:
      enabled: false

  docs.example.com:
    aliases: []
    git:
      enabled: true
      url: "https://git.example.com/org/docs.git"
      branch: "main"
      path: "public"
      poll_seconds: 0              # 0 = no periodic poll (default); e.g. 300 = every 5 minutes
      webhook_secret: "unique-secret-for-this-repo"   # required for webhooks; unique per domain entry
```

### Git poll & webhook (overview)

| Mechanism | How |
|-----------|-----|
| **Poll** | Per domain `git.poll_seconds` (default **`0`** = disabled). When &gt; 0, Lumina `fetch`/`pull`s on that interval. |
| **Webhook** | `POST /_lumina/hooks/git` — **GitHub**, **GitLab**, **Forgejo/Gitea**. Same URL for all repos. |

Webhook calls are **coalesced** (5-minute window): first call after a quiet period runs immediately; calls inside the window schedule one deferred sync and ignore the rest; a hit while a sync is running schedules a follow-up after 5 minutes.

Sample operator file: [`config/config.example.yaml`](./config/config.example.yaml).

---

## Setting up git webhooks

Use webhooks when a forge (GitHub / GitLab / Forgejo) should tell Lumina to pull **immediately** after a push. Polling is optional backup (`poll_seconds`); for webhooks you only need a reachable Lumina URL and matching secrets.

### 1. Public URL Lumina must receive

All forges call the **same** path (not tied to a site `Host`):

```text
https://<your-lumina-public-host>/_lumina/hooks/git
```

Examples:

- Behind a reverse proxy / cloudflared: `https://lumina.example.com/_lumina/hooks/git`
- Local test only: `http://127.0.0.1:3030/_lumina/hooks/git` (forge must reach that machine)

Requirements:

- `POST` must reach the Lumina process (map your published port / tunnel to `LUMINA_PORT`, default `3030`).
- Path `/_lumina/hooks/git` is handled **before** domain virtual hosting — you do **not** create a domain entry just for the webhook.
- TLS is usually terminated on the proxy; Lumina itself can stay HTTP on the internal port.

### 2. `config.yaml` (one secret per domain / repo)

Each git-backed domain needs:

- `git.enabled: true`
- `git.url` — clone URL of the **same** repository you configure on the forge (HTTPS or SSH form; Lumina normalizes them for matching)
- `git.branch` — branch you want (must match push `refs/heads/<branch>`)
- `git.webhook_secret` — **unique** random string for this domain entry only  
  (domains **without** `webhook_secret` cannot be triggered by the webhook)
- optional: `git.path` (subfolder inside the repo), `git.poll_seconds` (default `0`)

```yaml
# /path/to/your/config.yaml  → mounted as LUMINA_CONFIG

paths:
  domains_dir: /data/domains
  git_cache_dir: /data/git-cache

domains:
  # Public site hostname → content from this git repo
  docs.example.com:
    aliases:
      - www.docs.example.com
    git:
      enabled: true
      url: "https://github.com/acme/docs.git"   # must match the forge repo
      branch: "main"
      path: "public"                            # optional subfolder in the repo
      poll_seconds: 0                           # webhooks only; or e.g. 600 as backup
      # Generate a long random value; never reuse across domains
      webhook_secret: "docs-only-9f3c2a1b7e8d4c6a"

  blog.example.com:
    git:
      enabled: true
      url: "https://gitlab.com/acme/blog.git"
      branch: "main"
      poll_seconds: 0
      webhook_secret: "blog-only-c4e1a92f0b3d7e15"   # different secret
```

Generate secrets yourself, for example:

```bash
openssl rand -hex 32
```

After saving `config.yaml`, Lumina reloads it (when watching is enabled). No image rebuild.

Also ensure git-cache is **writable**:

```yaml
# compose excerpt
volumes:
  - /path/to/config.yaml:/config/config.yaml:ro
  - lumina-git-cache:/data/git-cache   # rw — clones and pulls land here
environment:
  LUMINA_CONFIG: /config/config.yaml
  LUMINA_GIT_CACHE_DIR: /data/git-cache
```

### Private repositories (recommended: token in `git.url`)

A webhook only **triggers** sync. Lumina still runs `git clone` / `git pull` against the remote. For **private** repos the process must authenticate.

**Recommended approach:** put a personal access token / deploy token **in the HTTPS URL** in `config.yaml` (`git.url`). That is the simplest setup for Docker: no extra SSH agent or key mounts.

```yaml
domains:
  docs.example.com:
    git:
      enabled: true
      # Public form (no auth) — fine for public repos only:
      # url: "https://github.com/acme/docs.git"
      #
      # Private repo — RECOMMENDED: embed a token in the URL
      # GitHub: use a fine-scoped PAT (contents:read) or classic PAT
      # GitLab: Project/Group Access Token or PAT with read_repository
      # Forgejo: application token / access token with repository read
      url: "https://x-access-token:GITHUB_PAT@github.com/acme/docs.git"
      # GitLab example:
      # url: "https://oauth2:GITLAB_TOKEN@gitlab.com/acme/docs.git"
      # Forgejo example:
      # url: "https://YOUR_USER:FORGEJO_TOKEN@git.example.com/acme/docs.git"
      branch: "main"
      webhook_secret: "docs-only-9f3c2a1b7e8d4c6a"
```

| Forge | Typical HTTPS URL with token |
|-------|------------------------------|
| **GitHub** | `https://x-access-token:<TOKEN>@github.com/org/repo.git` |
| **GitLab** | `https://oauth2:<TOKEN>@gitlab.com/group/repo.git` (or `https://gitlab-ci-token:<TOKEN>@…` / username + PAT as password) |
| **Forgejo** | `https://<USER>:<TOKEN>@<forge-host>/<owner>/<repo>.git` |

**Webhook matching:** Lumina compares repository identity **without** userinfo. A forge payload with `https://github.com/acme/docs.git` still matches a configured `https://x-access-token:…@github.com/acme/docs.git`. You do **not** put the PAT into the forge webhook settings—only into Lumina’s `git.url`.

**Security notes:**

- Prefer a **read-only**, **repo-scoped** token; rotate it if leaked.
- Treat `config.yaml` as secret: mount it read-only, restrict filesystem permissions, do not commit real tokens to git.
- `webhook_secret` is separate: it authenticates the **forge → Lumina** call; the URL token authenticates **Lumina → forge** clone/pull.
- SSH deploy keys remain possible (`git@host:org/repo.git` + keys in the environment), but for most stacks the **token-in-URL** form is easier to operate.

### 3. GitHub

1. Open the repository → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:**  
   `https://<your-lumina-public-host>/_lumina/hooks/git`
3. **Content type:** `application/json`
4. **Secret:** paste the **exact** same string as `git.webhook_secret` for that domain in `config.yaml` (e.g. `docs-only-9f3c2a1b7e8d4c6a`).
5. **Which events:** choose **Just the push event**.
6. Ensure the webhook is **Active** → **Add webhook**.
7. Push a commit to `main` (or the branch in YAML). In the webhook’s **Recent Deliveries**, you should see `200` or `202`.

Lumina verifies GitHub using header `X-Hub-Signature-256` (HMAC-SHA256 of the body with your secret).

If the delivery fails with **401**, the secret does not match any domain entry. If **202** with `ignored_no_matching_domain`, the secret matched a domain but `git.url` / `branch` did not match the payload repo.

### 4. GitLab

1. Open the project → **Settings** → **Webhooks** (or **Settings** → **Integrations** → **Webhooks**, depending on GitLab version).
2. **URL:**  
   `https://<your-lumina-public-host>/_lumina/hooks/git`
3. **Secret token:** same value as that domain’s `git.webhook_secret` in `config.yaml`.
4. **Trigger:** enable **Push events**.  
   Optionally restrict to the branch you set in YAML (e.g. `main`).
5. SSL verification: leave enabled if Lumina is served over HTTPS (recommended).
6. **Add webhook** → use **Test** → **Push events** if available, or push a commit.

Lumina verifies GitLab using header `X-Gitlab-Token` (compared to `webhook_secret`).

`git.url` in YAML should match the project’s HTTP or SSH clone URL (e.g. `https://gitlab.com/acme/blog.git`).

### 5. Forgejo (and Gitea-compatible)

Forgejo webhooks follow the same pattern as Gitea.

1. Open the repository → **Settings** → **Webhooks** → **Add webhook** → choose **Forgejo** / **Gitea**.
2. **Target URL:**  
   `https://<your-lumina-public-host>/_lumina/hooks/git`
3. **HTTP Method:** `POST`
4. **Secret:** same as `git.webhook_secret` for that domain in `config.yaml`.
5. **Trigger on:** **Push events** (and only the branch you care about, if the UI allows).
6. Content type: JSON.
7. **Add webhook** → push to the configured branch.

Lumina verifies Forgejo/Gitea using `X-Gitea-Signature` or `X-Forgejo-Signature` (HMAC-SHA256 hex of the body).

`git.url` should match the clone URL shown in the Forgejo UI (HTTPS or SSH).

### 6. Checklist (all forges)

| Step | Check |
|------|--------|
| 1 | Domain exists under `domains:` with `git.enabled: true` |
| 2 | `git.url` points at that exact repository |
| 3 | `git.branch` is the branch you push to |
| 4 | `git.webhook_secret` is set and **unique** for this domain |
| 5 | Forge webhook URL is `…/_lumina/hooks/git` |
| 6 | Forge secret/token equals `webhook_secret` |
| 7 | Only **push** events are sent |
| 8 | Private repos: token embedded in `git.url` (recommended) or other git auth |
| 9 | `LUMINA_GIT_CACHE_DIR` volume is writable |

### 7. Quick local verify

```bash
# Replace secret + URL with your config.yaml values
BODY='{"ref":"refs/heads/main","repository":{"clone_url":"https://github.com/acme/docs.git"}}'
SECRET='docs-only-9f3c2a1b7e8d4c6a'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -sS -X POST "http://127.0.0.1:3030/_lumina/hooks/git" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY"
```

Expect JSON with `"ok": true` and `"action"` one of `started` | `scheduled` | `ignored` | `rescheduled`.

### Paths inside the container

| Path | You mount? | Role |
|------|------------|------|
| `/app` | no | Server binary (in the image) |
| `/config/config.yaml` | yes | Your configuration |
| `/data/domains` | yes | Site folders |
| `/data/git-cache` | yes (volume, writable) | Git working trees |
| `/data/secrets` | optional | Credentials for private git (never served) |

---

## Adding a new domain

1. Create a folder under your sites mount, e.g. `/path/to/your-lumina-data/sites/shop.example.com/`.
2. Add `index.html` (and any assets).
3. Register it in `config.yaml`:

```yaml
domains:
  shop.example.com:
    root: shop.example.com
    aliases:
      - www.shop.example.com
```

4. Save the file — Lumina reloads config (when watching is enabled). Point DNS or your reverse proxy at Lumina.

---

## Security (what is not published)

Lumina answers **404** for sensitive or internal paths, for example:

- `.git/`, other VCS metadata  
- `node_modules/`, lockfiles, `package.json`  
- `.env`, keys, certificates  
- Agent/tooling files such as `agents.md`  
- Most hidden (dot) paths — exception: `.well-known/` (e.g. ACME)

Do not rely on “security by obscurity”: keep secrets out of public site trees when you can, and mount secrets read-only where needed.

---

## Reverse proxies & tunnels

Lumina is built to sit **behind** a reverse proxy or tunnel. Virtual hosting uses the **public hostname** from the browser (or tunnel), not the internal Docker/service name.

### How Lumina picks the hostname

In order (first non-empty wins):

1. `X-Forwarded-Host` (first value if comma-separated)  
2. `Forwarded` header — `host=` (RFC 7239)  
3. `X-Original-Host`  
4. `Host`  
5. Hostname from the request URL  

Register every public name as a **domain key or alias** in YAML. One Lumina process can serve all vhosts; proxy to `lumina:3030` (or your `LUMINA_PORT`).

If the host is unknown, Lumina returns an **HTML 404** with diagnostics and a suggested config snippet.

### Works with (among others)

| Front-end | Typical use |
|-----------|-------------|
| **nginx** | TLS termination, HTTP/2, static edge |
| **HAProxy** | L7 load balancing, multi-backend |
| **Caddy** | automatic HTTPS |
| **Traefik** | Docker / Swarm / K8s ingress |
| **cloudflared** | Cloudflare Tunnel |
| **Apache httpd**, **Envoy**, etc. | any proxy that forwards the original host |

All of these work the same way from Lumina’s perspective: forward the original host (and preferably proto) to the backend.

### What the proxy must send

| Header | Purpose |
|--------|---------|
| **Original host** | So Lumina can match `domains:` / `aliases:` — via preserved `Host`, and/or `X-Forwarded-Host`, and/or RFC `Forwarded` |
| **Optional** `X-Forwarded-Proto` | `https` when TLS ends at the proxy (useful for apps/links; host routing does not require it) |

Do **not** replace the public hostname with the internal upstream name only (e.g. only `Host: lumina:3030`) unless you also send `X-Forwarded-Host: public.example.com`.

### Example snippets (illustrative)

**nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name example.com www.example.com docs.example.com;

    # ssl_certificate ...;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**HAProxy**

```haproxy
frontend https_in
    bind :443 ssl crt /etc/ssl/certs/site.pem
    mode http
    default_backend lumina

backend lumina
    mode http
    server lumina1 127.0.0.1:3030 check
    # Preserve client host for Lumina virtual hosting
    http-request set-header X-Forwarded-Host %[req.hdr(Host)]
    http-request set-header X-Forwarded-Proto https if { ssl_fc }
```

**Caddy**

```caddy
example.com, www.example.com {
    reverse_proxy 127.0.0.1:3030
}
```

(Caddy forwards `Host` by default; that is enough. You may also set explicit forwarded headers if you use a more complex chain.)

**Traefik** (Docker labels sketch)

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.lumina.rule=Host(`example.com`) || Host(`www.example.com`)
  - traefik.http.services.lumina.loadbalancer.server.port=3030
```

**cloudflared** (Tunnel)

Point the tunnel public hostname at the Lumina service (`http://lumina:3030` or `http://127.0.0.1:3030`). Cloudflare/cloudflared typically supplies the public hostname via forwarded headers; still list that hostname under `domains:` / `aliases:` in YAML.

### Multi-domain tip

You can terminate TLS for **many** names on nginx/HAProxy/Caddy and send everything to a **single** Lumina upstream. Lumina then selects the site from the forwarded host. No need for one container per domain.

---

## Common issues

| Symptom | Check |
|---------|--------|
| Always 404 “Unknown host” | `Host` header / DNS name must match a domain or alias in config |
| Files missing after edit | Confirm the volume mount path; for git sites, confirm pull succeeded |
| Git domain empty | Network access to the remote; branch name; writable git-cache volume |
| Want a clean boot without watchers | `LUMINA_WATCH=0` |

---

## Try the bundled examples (optional)

If you have [Bun](https://bun.sh) and this repository checked out, you can try the sample sites without writing your own config:

```bash
bun install
./startDevServer.sh
# or: bun run dev
# http://localhost:3030/  (default port; localhost → example.com in the sample config)
```

That path is for a quick look or demos. Day-to-day hosting is still: **image + mounts**.

---

## For developers of Lumina

Architecture, hard project rules, source layout, tests, and contribution constraints are documented in **[`agents.md`](./agents.md)**.

---

## License

Lumina is licensed under the **[GNU Affero General Public License v3.0](./LICENSE)** (`AGPL-3.0-only`).

- You may use, share, and modify the software freely.
- If you distribute modified versions, or run a **modified** Lumina as a network service, you must make the corresponding source available under AGPL-3.0 (see the license text).

This is intentional: the project should stay open, and improvements should remain available to the community — including when Lumina is offered as a hosted service.
