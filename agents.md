# agents.md — Lumina development specification

This document is for **people and agents who develop Lumina itself**.

End users who only want to **run** the server (Docker, config, sites) should read **[`README.md`](./README.md)** instead.  
To **add or program HTTP endpoints** on a site served by Lumina (not core server code), follow **[`ENDPOINTS.md`](./ENDPOINTS.md)**.

---

## What Lumina is

**Lumina** = **L**ightweight **U**niversal **M**ulti-domain **I**ntelligent **N**etworking **A**rchitecture

A Bun-based multi-domain HTTP server:

- Host-header virtual hosting + aliases  
- Static files + PHP-like file-based dynamic routes  
- Hot-reload of YAML config and site content  
- Optional git-backed domain content  
- Docker-first delivery: **ready image**, no build/install at stack start  
- Reverse-proxy / tunnel friendly (nginx, HAProxy, Caddy, Traefik, cloudflared, …) via `X-Forwarded-Host` / `Forwarded` / `Host` — see README  


Language of **everything on disk** in this repository (code, docs, comments, config samples, commits): **English**. Discussion with humans may be multilingual.

---

## Hard project conditions (non-negotiable)

### 1. Docker runtime: zero build / install / download of the server

When Lumina is used in Compose / Swarm / Kubernetes:

| Forbidden at container start | Required instead |
|------------------------------|------------------|
| `bun install` / `npm install` | All deps resolved at **image build** |
| `tsc` / bundle / compile | Artifact already in `/app` |
| Fetching server packages from a registry | Self-contained image layers |
| Multi-step “build then run” entrypoints | `ENTRYPOINT` only starts the process |

Git **clone/pull of site content** (when `git.enabled`) is **content sync**, not application build. It may use the network; it must never install language packages or compile Lumina.

Prefer a **single bundled artifact** (`bun build` → `/app/main.js`). Publish immutable tags/digests; operators pull, they do not compile on the host.

### 2. Never serve internal / sensitive / tooling paths

Static (and any accidental path) serving **must** deny:

- Agent/tooling: `agents.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/`, `.grok/`, …  
- VCS: `.git/`, `.svn/`, …  
- Dependencies & manifests: `node_modules/`, `package.json`, lockfiles, …  
- Secrets: `.env`, `*.pem`, `*.key`, SSH keys, …  
- Hidden path segments by default, except **`.well-known/`**  
- Raw dynamic route sources under `routes/` (execute only, do not download as static)  

On match → **404** (prefer not leaking existence via 403).  
Normalize / jail paths **before** deny checks; reject traversal outside the domain root.

Config may **add** deny patterns later; core rules must not be weak by default (no escape hatch in v1).

Implementation: `src/security/deny-paths.ts`, `src/security/path-safe.ts`.

### 3. Config and data live outside the image

| In image | Mounted at runtime |
|----------|--------------------|
| Prebuilt server under `/app` | `/config/config.yaml` |
| `git` CLI for content sync | `/data/domains` |
| Empty mount points | `/data/git-cache` (rw) |

Env:

| Variable | Role |
|----------|------|
| `LUMINA_PORT` | Listen port — **never YAML**. Default **`3030`** (`DEFAULT_PORT`) |
| `LUMINA_HOST` | Bind address — **never YAML**. Default **`0.0.0.0`** (`DEFAULT_HOST`) |
| `LUMINA_CONFIG` | Path to YAML |
| `LUMINA_DOMAINS_DIR` | Default domains base |
| `LUMINA_GIT_CACHE_DIR` | Git cache base |

YAML has **no `server:` section** (rejected by strict schema).

### 4. Keep the core small

- Runtime: **Bun**  
- HTTP pipeline: fetch handler / **Hono** where useful  
- Config: **YAML + Zod**  
- Prefer native watchers over heavy frameworks  
- Git optional per domain  

### 5. English on disk

All repository artifacts that ship or are committed stay in English (see above).

---

## Product goals

1. **Multi-domain & aliases** — one process, many hostnames; aliases share a root.  
2. **File-based routing** — drop files into a domain tree; static + `routes/*.ts|js`.  
3. **Hot reload** — config and content changes without process restart (when watch enabled).  
4. **Git-backed domains** — clone/pull into cache; serve working tree (+ optional subpath).  
5. **Operator simplicity** — new site ≈ folder + few YAML lines.  
6. **Production reliability** — path jail, deny list, graceful enough lifecycle for containers.  

User-facing behavior and deploy examples: [`README.md`](./README.md).

---

## Technology stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun (≥ 1.1) |
| Language | TypeScript |
| Validation | Zod |
| YAML | `yaml` package |
| HTTP | Bun.serve + app `fetch`; Hono-compatible route exports |
| Dynamic routes | Custom file→pattern mapper (`[id]`, `[...slug]`) + dynamic import |
| Watch | `fs.watch` (debounced) |
| Git | `git` CLI via `Bun.spawn` |
| Image | Multi-stage Dockerfile → Alpine runtime (+ git), no install on start |

---

## Source layout

```text
src/
  main.ts                 # CLI entry
  app.ts                  # request pipeline (/_lumina → domain → dynamic → static)
  constants.ts            # DEFAULT_PORT 3030, DEFAULT_HOST 0.0.0.0
  config/
    schema.ts             # Zod (no server: key)
    load.ts               # load + path resolution + Host normalize
    watch.ts              # config hot-reload
    types.ts              # ResolvedConfig, ResolvedDomain
  server/
    lifecycle.ts          # start/stop, watchers, git poll + webhook coalescer
  routing/
    domain-resolver.ts
    request-host.ts       # X-Forwarded-Host / Forwarded / Host (proxies)
    static.ts
    dynamic.ts
    unknown-host.ts       # HTML 404 for unknown Host
  security/
    deny-paths.ts
    path-safe.ts
  git/
    manager.ts            # clone/pull
    poll.ts               # poll_seconds intervals
    webhook.ts            # POST /_lumina/hooks/git
    coalesce.ts           # 5-minute webhook coalesce rules
    url-match.ts          # normalize forge URLs
  watch/
    fs-watcher.ts
  logging/
    logger.ts
tests/
  unit/
  integration/
examples/                 # local fixtures only
config/config.example.yaml
ENDPOINTS.md              # canonical guide for site routes (AI + humans)
Dockerfile
.github/workflows/ci.yml  # test + multi-arch GHCR publish
startDevServer.sh         # local dev on port 3030
```

### Module responsibilities

| Area | Rules |
|------|--------|
| Domain resolve | Proxy-aware host → `hostIndex` → `ResolvedDomain` |
| Dynamic routes | Prefer over static; map `routes/` files to URL patterns; cache-bust imports on reload |
| Static | Safe join + deny on path **relative to domain root only**; directory → `index.html` |
| Config reload | Re-parse YAML, re-resolve roots, re-sync git if enabled, rebuild route tables |
| Git | Cache under `gitCacheDir/<sanitized-domain>/`; optional `git.path` subdir becomes serve root |
| Webhook | Global path; per-domain `webhook_secret`; 5-min coalesce (see `coalesce.ts` + comment on `webhook.ts`) |

---

## Config model (implementation)

Schema: `src/config/schema.ts`.

```yaml
# No server: block. Listen via LUMINA_HOST / LUMINA_PORT only.
paths:
  domains_dir: /data/domains
  git_cache_dir: /data/git-cache
domains:
  example.com:
    root: example.com       # relative to domains_dir or absolute
    aliases: [www.example.com]
    routesDir: routes
    git:
      enabled: false
      url: "..."
      branch: main
      path: public            # subpath inside clone
      poll_seconds: 0         # 0 = no poll
      webhook_secret: "..."   # unique per domain; required for /_lumina/hooks/git
```

**Listen resolution:**  
- host: `LUMINA_HOST` → else `DEFAULT_HOST` (`0.0.0.0`)  
- port: `LUMINA_PORT` → else `DEFAULT_PORT` (`3030`)  

Top-level `server:` in YAML is **rejected** (strict schema).  

Resolution order for base dirs: process env → YAML `paths.*` → defaults.  
Duplicate hostname → hard error at load.

---

## Denied paths (summary)

Full patterns live in `src/security/deny-paths.ts` and must stay covered by tests.

**Always blocked directory segments (examples):**  
`.git`, `node_modules`, `.bun`, `vendor`, `.venv`, `git-cache` (**URL / relative-to-root only** — parent dirs of a domain root must not deny the whole site), `.ssh`, `.github`, `.cursor`, `.grok`, …

**Always blocked basenames (examples):**  
`agents.md`, `.env`, `package.json`, lockfiles, `tsconfig.json`, `config.yaml`, `Dockerfile*`, keys, logs, …

**Dot policy:** any path segment starting with `.` denied, except `.well-known/`.

---

## Development workflow

Requires Bun.

```bash
bun install
bun run dev          # watch + examples/config.yaml + examples/domains
bun run dev:once     # no --watch on the process entry
bun test             # unit + integration
bun run test:watch
bun run build        # dist/main.js — same class of artifact as Docker
bun run typecheck
```

Defaults for local dev (`./startDevServer.sh` / `package.json` `dev` script):

- `LUMINA_CONFIG=./examples/config.yaml`  
- `LUMINA_DOMAINS_DIR=./examples/domains`  
- `LUMINA_GIT_CACHE_DIR=./.data/git-cache`  
- `LUMINA_PORT=3030` (same as global default; set only via env)  

Integration tests start the server with `watch: false`, `syncGit: false`, ephemeral port, and call `app.fetch` with an explicit `Host` (HTTP clients may rewrite `Host` on real sockets).

### Docker image (build machine / CI only)

```bash
docker build -t lumina:dev .
docker run --rm -p 3030:3030 \
  -e LUMINA_PORT=3030 \
  -v "$PWD/examples/config.yaml:/config/config.yaml:ro" \
  -v "$PWD/examples/domains:/data/domains:ro" \
  -v lumina-git-cache:/data/git-cache \
  lumina:dev
```

Runtime hosts should **pull** a built image, not depend on compiling Lumina.

---

## Testing requirements

- **Unit:** deny-paths, path-safe (incl. traversal), config load, domain resolve, route pattern mapping.  
- **Integration:** multi-domain, aliases, static, dynamic routes, denied files (`agents.md`, `.env`), unknown host, shared root domains.  
- New deny rules or routing behavior → add tests in the same PR.  
- Do not require network for the default test suite (git sync off in tests).

---

## Request pipeline (current)

```text
Request
  → if path is /_lumina/hooks/git → git webhook (global, not Host-routed)
  → resolve domain by public Host (X-Forwarded-Host → Forwarded → Host → URL)
  → if unknown host → HTML 404 diagnostics (no list of configured hosts)
  → dynamic route table match → handler
  → else static file (deny + jail)
  → else 404 JSON
```

Response headers when domain matched: `X-Lumina-Domain`, `X-Lumina-Host`.

---

## Implementation notes & constraints for agents

- Prefer small, focused modules; avoid drive-by refactors.  
- Do not weaken deny-list or path jail for convenience.  
- Do not add package installs or compile steps to container entrypoint.  
- **Never** reintroduce a YAML `server:` section — listen host/port are env-only (`LUMINA_HOST` / `LUMINA_PORT`).  
- Operator docs belong in **README**; keep **agents.md** as the engineering contract.  
- Route modules: support `default` export as `(req, params?) => Response`, Hono app, or `{ fetch }`.  
- Hot reload: debounce watchers; rebuild route tables on content/config change.  
- Git failures should log and not necessarily crash unrelated domains (fail soft per domain where possible).  
- Follow **Maintainer push protocol** below whenever the user asks to push.

---

## Maintainer push protocol

When the user says **push** (or equivalent: “commit and push”, “push it”), the agent **must** do all of the following in order — no separate confirmation beyond that word:

1. **Review changes** — `git status`, diffs, recent commits; do not commit secrets (`.env`, real tokens in config samples).
2. **Bump the build/patch version** — always increment the **last** number of the project version (SemVer **PATCH**):
   - Canonical source: `package.json` → `"version": "MAJOR.MINOR.PATCH"`
   - Example: `0.1.0` → `0.1.1` → `0.1.2`
   - Do **not** bump MINOR/MAJOR on a normal push unless the user explicitly asks for a feature/breaking release.
   - If other files embed the same version string for packaging, keep them in sync (today: primarily `package.json`).
3. **Stage** all intended project files (`git add` relevant paths; respect `.gitignore`).
4. **Commit** with a message in English that states **what** changed and **why** (complete sentences; no fluff). Include the new version in the subject or body when useful (e.g. `Release 0.1.2: …` or footer `Version: 0.1.2`).
5. **Push** to `origin` on the current branch (typically `main`): `git push` / `git push -u origin HEAD` as needed.
6. If there is **nothing to commit** except the version bump is still required only when there are real changes — if the tree is clean and the user only wanted a no-op push, push existing commits without a fake empty commit. If there **are** changes, the version bump is mandatory on that same push.

Do **not** force-push, amend published history, or skip hooks unless the user explicitly orders that.

---

## License (project policy)

**Chosen license: [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) (`AGPL-3.0-only`).**

| Goal | How AGPL-3.0 fits |
|------|-------------------|
| Fully open source | Anyone may use, study, share, and modify the software. |
| Changes must stay public | Copyleft: distributed modifications must be under AGPL-3.0 with source. |
| Network / SaaS loophole closed | If you run a **modified** Lumina as a service over the network, you must offer the corresponding source to users of that service (AGPL §13) — stronger than GPL for servers. |

**Not sufficient for the “changes must be public” goal:** MIT, BSD, Apache-2.0 (allow closed forks).  
**Weaker for server software:** GPL-3.0 alone (modify + offer only as a network service without distributing binaries may avoid sharing source).  

License text: [`LICENSE`](./LICENSE). `package.json` field: `"license": "AGPL-3.0-only"`.  
Copyright holder for NOTICE purposes: project author(s) as recorded in git history / GitHub `lubino/lumina`.

---

## Feature backlog (post-core)

1. Mask secrets in logs (`git.url` tokens must never appear in log lines)  
2. Optional SSH deploy-key auth without embedding tokens in URLs  
3. Rate limiting / request size limits on HTTP and webhooks  
4. Metrics / structured access logs  
5. Optional Bun `FileSystemRouter` alignment if it simplifies matching further  
6. Codecov not desired — coverage stays CI artifact / local `bun run test:coverage` only  

---

## Critical bugs fixed (do not reintroduce)

| Issue | Cause | Fix |
|-------|--------|-----|
| Git-backed sites always 404 (`Not Found`) despite `index.html` | `resolveStaticFile` ran deny checks on **absolute** path; segment `git-cache` blocked all files under `LUMINA_GIT_CACHE_DIR` | Deny only path **relative to domain root** (`src/routing/static.ts`) |
| RPi Portainer: no matching manifest arm64 | GHCR image was amd64-only | CI multi-arch `linux/amd64,linux/arm64` + QEMU |
| `EISDIR` on startup | `LUMINA_CONFIG` pointed at a **directory** (Docker created a dir when host file missing) | Operator: real YAML **file** bind-mounted file→file |
| `EACCES mkdir git-cache/...` | Container user `lumina` cannot write host bind mount | Operator: `chown` git-cache to container UID or writable perms; mount **rw** |
| Mount file vs directory error | Host path type ≠ container path type | File↔file, dir↔dir; create host files **before** first deploy |

---

## Ops lessons (Portainer / RPi / production)

- **Image:** `ghcr.io/lubino/lumina:latest` (multi-arch). Repo: `git@github.com:lubino/lumina.git`.  
- **Ports:** prefer `3030:3030` when using default `LUMINA_PORT`.  
- **Portainer:** use **absolute** host paths for binds; relative `./` is unreliable. Refresh = pull image + recreate (not mere restart).  
- **Config file name:** can be `config.yml` or `config.yaml` — must match `LUMINA_CONFIG` and the bind target.  
- **Host routing:** browser `Host` (or Cloudflare public name) must be a domain key or alias; IP-only access needs an alias.  
- **Git private repos:** recommend token in `git.url` (README); **never commit real tokens**; rotate if leaked to chat/logs.  
- **Webhook:** `POST /_lumina/hooks/git`; auth = per-domain `git.webhook_secret` in YAML (not env). Verified working via Cloudflare with plain `X-Lumina-Webhook-Secret` and forge-style headers.  
- **Unknown-host HTML:** show requested host + suggested YAML; **never** list all configured hostnames; put resolved config path next to `LUMINA_CONFIG` in “How to fix”, not in footer.  

---

## Documentation map

| File | Audience |
|------|----------|
| [`README.md`](./README.md) | Operators / users of the ready server (deploy, config, webhooks, proxies) |
| [`ENDPOINTS.md`](./ENDPOINTS.md) | **Creating site endpoints** (JS/TS under `routes/`) — AI + humans |
| [`agents.md`](./agents.md) | Developers & coding agents (this file) — architecture, hard rules, session continuity |

**README must stay operator-complete:** Docker/Portainer stack, env vars, no `server:` in YAML, ports 3030, multi-domain, static+endpoints link to ENDPOINTS.md, git poll/webhook + forge setup, private repo token-in-URL, reverse proxies (nginx/HAProxy/Caddy/Traefik/cloudflared), security deny list summary, project status badges (CI, license, GHCR; no Codecov), AGPL license blurb.

---

## Session continuity (handoff)

Last focused production work: git-backed domain `cc10.cz` behind Cloudflare; clone OK; 404 fixed by git-cache deny bug (v0.1.4). Webhook with domain secret returns `action: started` for `cc10.cz`.  

**Current version at handoff:** see `package.json` (expect ≥ `0.1.4`).  
**Remote:** `origin` → `git@github.com:lubino/lumina.git`, branch `main`.  
**Image:** `ghcr.io/lubino/lumina` multi-arch via `.github/workflows/ci.yml`.  

When resuming: read this file + README + ENDPOINTS.md; do not re-open closed product decisions (AGPL, env-only listen, per-domain webhook secrets, push = patch bump + commit + push).

---

## Production server ops — Swiss (auto-load this every session)

**Purpose:** Any agent working in this repo may control / configure the live Lumina instance on the user’s server without the user re-explaining topology. **Never commit real git tokens or webhook secrets into git**; read them from the server config when needed, do not paste them into commits or public docs.

### Access

| Item | Value |
|------|--------|
| SSH | `ssh swiss` (alias already configured on the maintainer machine) |
| OS user | `rpi` |
| Home | `/home/rpi` |
| Lumina host data | `/home/rpi/docker/lumina/` |
| Orchestration | Portainer stack on this host (compose-style); image from GHCR |

```bash
ssh swiss '…'   # preferred non-interactive form
```

### On-disk layout (host)

```text
/home/rpi/docker/lumina/
├── config.yml          # LIVE config (LUMINA_CONFIG target)
├── domains/            # usually empty — sites are git-backed
└── git-cache/          # clones; must be writable by container UID (~999)
    ├── cc10.cz/
    └── lalen.implcode.com/
```

### Typical container env / mounts (Portainer)

| Env | Typical value |
|-----|----------------|
| `LUMINA_CONFIG` | `/config/config.yml` (or `/data/config.yml` if mounted that way — **match the volume**) |
| `LUMINA_DOMAINS_DIR` | `/data/domains` |
| `LUMINA_GIT_CACHE_DIR` | `/data/git-cache` |
| `LUMINA_PORT` | `3030` |
| Ports | `3030:3030` |
| Image | `ghcr.io/lubino/lumina:latest` |

Bind mounts (example):

```text
host config.yml  →  container config path (file→file, not directory)
host domains/    →  /data/domains
host git-cache/  →  /data/git-cache  (rw, not :ro)
```

### Live domains (as last known from server config)

| Domain | Source | Branch | Poll | Webhook | Notes |
|--------|--------|--------|------|---------|--------|
| `cc10.cz` | Forgejo `lubino/cc10.cz.git` | `main` | off (0) | yes (`webhook_secret` in config) | static site in repo root (`index.html`, css/, js/) |
| `lalen.implcode.com` | Forgejo `lubino/lalenfasion.git` | `main` | **off** (`poll_seconds: 0`) | yes | static site in repo root; poll was disabled by request |

Secrets (`git.url` tokens, `webhook_secret`) live **only** in `/home/rpi/docker/lumina/config.yml` on the server — read via SSH when operating; never copy into the git repo.

### How to configure (agent procedures)

1. **Read config:**  
   `ssh swiss 'cat /home/rpi/docker/lumina/config.yml'`
2. **Edit config carefully** (prefer scripted edit that preserves structure; keep tokens on server only):  
   `ssh swiss` + edit `/home/rpi/docker/lumina/config.yml`
3. **Hot reload:** if `LUMINA_WATCH` is on (default), saving config is enough; otherwise recreate/restart the Portainer container/stack.
4. **Inspect git working trees:**  
   `ssh swiss 'ls -la /home/rpi/docker/lumina/git-cache/<domain>/'`
5. **Logs:** Portainer container logs, or `docker logs` on swiss if CLI available.
6. **Webhook test (from internet / CF):**  
   `POST https://<public-host>/_lumina/hooks/git` with that domain’s `webhook_secret` (header `X-Lumina-Webhook-Secret` or forge-native signature).
7. **Image update:** wait for CI multi-arch publish; on Portainer **pull + redeploy** (not mere restart).
8. **Public sites** often sit behind Cloudflare; direct `:3030` may not be open from WAN.

### Known product constraints when operating Swiss

- No `server:` block in YAML; listen only via env.  
- Unknown Host → HTML 404 **without** listing other hostnames.  
- Git sites must not be false-denied because of parent path `git-cache` (fixed in 0.1.4+).  
- Private git: token in `git.url` is the deployed pattern; rotate if leaked to chat/logs.

### What not to do

- Do not commit `/home/rpi/docker/lumina/config.yml` or paste live tokens into README/agents samples.  
- Do not `chmod 777` casually in docs as the only advice — prefer `chown` to container UID (`docker run --rm --entrypoint id ghcr.io/lubino/lumina:latest`).  
- Do not assume `domains/` has content — current Swiss setup is git-cache only.

---

**Status:** Core server shipped; CI publishes multi-arch images; operator and endpoint docs in place; Swiss production ops documented above for auto-load.  
**Priority:** Keep operator README accurate; never reintroduce git-cache absolute-path deny; mask secrets in logs next.
