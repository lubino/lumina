# agents.md — Lumina development specification

This document is for **people and agents who develop Lumina itself**.

End users who only want to **run** the server (Docker, config, sites) should read **[`README.md`](./README.md)** instead.

---

## What Lumina is

**Lumina** = **L**ightweight **U**niversal **M**ulti-domain **I**ntelligent **N**etworking **A**rchitecture

A Bun-based multi-domain HTTP server:

- Host-header virtual hosting + aliases  
- Static files + PHP-like file-based dynamic routes  
- Hot-reload of YAML config and site content  
- Optional git-backed domain content  
- Docker-first delivery: **ready image**, no build/install at stack start  

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
| Image | Multi-stage Dockerfile → slim runtime, no install on start |

---

## Source layout

```text
src/
  main.ts                 # CLI entry
  app.ts                  # request pipeline (domain → dynamic → static)
  config/
    schema.ts             # Zod
    load.ts               # load + path resolution + Host normalize
    watch.ts              # config hot-reload
    types.ts              # ResolvedConfig, ResolvedDomain
  server/
    lifecycle.ts          # start/stop, watchers, git sync hook
  routing/
    domain-resolver.ts
    static.ts
    dynamic.ts
  security/
    deny-paths.ts
    path-safe.ts
  git/
    manager.ts
  watch/
    fs-watcher.ts
  logging/
    logger.ts
tests/
  unit/
  integration/
examples/                 # local fixtures only (not production data)
config/config.example.yaml
Dockerfile
```

### Module responsibilities

| Area | Rules |
|------|--------|
| Domain resolve | `Host` → lowercase, strip port → `hostIndex` → `ResolvedDomain` |
| Dynamic routes | Prefer over static; map `routes/` files to URL patterns; cache-bust imports on reload |
| Static | Safe join + deny; directory → `index.html`; never serve denied basenames/segments |
| Config reload | Re-parse YAML, re-resolve roots, re-sync git if enabled, rebuild route tables |
| Git | Cache under `gitCacheDir/<sanitized-domain>/`; optional `git.path` subdir becomes serve root |

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
`.git`, `node_modules`, `.bun`, `vendor`, `.venv`, `git-cache`, `.ssh`, `.github`, `.cursor`, `.grok`, …

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
  → resolve domain by Host (or single-domain fallback)
  → dynamic route table match → handler
  → else static file (deny + jail)
  → else 404 JSON/text
```

Response header `X-Lumina-Domain` set to the canonical domain key when a domain was resolved.

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

1. Git private repos: recommend token embedded in `git.url` (documented in README); optional SSH later; poll + webhook already supported  
2. Rate limiting / request size limits  
3. Metrics / structured access logs  
4. CI: test + multi-arch image publish  
5. Optional Bun `FileSystemRouter` alignment if it simplifies matching further  
6. Document reverse-proxy TLS recipes in README as needed  

---

## Documentation map

| File | Audience |
|------|----------|
| [`README.md`](./README.md) | Operators / users of the ready server |
| [`agents.md`](./agents.md) | Developers & coding agents (this file) |

---

**Status:** Core server implemented under `src/` with unit + integration tests and example sites.  
**Priority:** Keep operator README simple; keep hard constraints and architecture here; extend features without breaking Docker zero-build or deny-path guarantees.
