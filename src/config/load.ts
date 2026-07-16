import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DEFAULT_HOST, DEFAULT_PORT } from "../constants";
import { ConfigSchema, type RawConfig } from "./schema";
import type { ResolvedConfig, ResolvedDomain, RuntimePaths } from "./types";

export type { RuntimePaths, ResolvedConfig, ResolvedDomain } from "./types";
export { DEFAULT_PORT, DEFAULT_HOST } from "../constants";

/**
 * Parse LUMINA_PORT. Invalid or empty → DEFAULT_PORT (3030).
 */
export function resolveListenPort(
  envValue: string | undefined = process.env.LUMINA_PORT,
): number {
  if (envValue === undefined || envValue.trim() === "") {
    return DEFAULT_PORT;
  }
  const n = Number(envValue);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(
      `Invalid LUMINA_PORT="${envValue}" (expected integer 1–65535)`,
    );
  }
  return n;
}

/**
 * Parse LUMINA_HOST. Empty / unset → DEFAULT_HOST (0.0.0.0).
 */
export function resolveListenHost(
  envValue: string | undefined = process.env.LUMINA_HOST,
): string {
  if (envValue === undefined || envValue.trim() === "") {
    return DEFAULT_HOST;
  }
  return envValue.trim();
}

export function resolveRuntimePaths(cwd = process.cwd()): RuntimePaths {
  const configPath = resolve(
    process.env.LUMINA_CONFIG ?? join(cwd, "examples", "config.yaml"),
  );
  const domainsDir = resolve(
    process.env.LUMINA_DOMAINS_DIR ?? join(cwd, "examples", "domains"),
  );
  const gitCacheDir = resolve(
    process.env.LUMINA_GIT_CACHE_DIR ?? join(cwd, ".data", "git-cache"),
  );

  const host =
    process.env.LUMINA_HOST !== undefined && process.env.LUMINA_HOST !== ""
      ? resolveListenHost(process.env.LUMINA_HOST)
      : undefined;

  const port =
    process.env.LUMINA_PORT !== undefined && process.env.LUMINA_PORT !== ""
      ? resolveListenPort(process.env.LUMINA_PORT)
      : undefined;

  return {
    configPath,
    domainsDir,
    gitCacheDir,
    host,
    port,
  };
}

export function loadRawConfig(configPath: string): RawConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const text = readFileSync(configPath, "utf8");
  const parsed: unknown = parseYaml(text) ?? {};
  return ConfigSchema.parse(parsed);
}

function resolveDomainRoot(
  name: string,
  domain: RawConfig["domains"][string],
  domainsDir: string,
  gitCacheDir: string,
): string {
  if (domain.git?.enabled) {
    const cacheRoot = join(gitCacheDir, sanitizeDomainKey(name));
    const sub = (domain.git.path ?? "").replace(/^\/+/, "");
    return sub ? join(cacheRoot, sub) : cacheRoot;
  }

  const root = domain.root ?? name;
  if (isAbsolute(root)) {
    return root;
  }
  return join(domainsDir, root);
}

export function sanitizeDomainKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function resolveConfig(
  raw: RawConfig,
  paths: RuntimePaths,
): ResolvedConfig {
  const domainsDir = resolve(raw.paths.domains_dir ?? paths.domainsDir);
  const gitCacheDir = resolve(raw.paths.git_cache_dir ?? paths.gitCacheDir);

  const domains = new Map<string, ResolvedDomain>();
  const hostIndex = new Map<string, string>();

  for (const [name, domain] of Object.entries(raw.domains)) {
    const resolved: ResolvedDomain = {
      name,
      root: resolveDomainRoot(name, domain, domainsDir, gitCacheDir),
      aliases: domain.aliases ?? [],
      routesDir: domain.routesDir ?? "routes",
      git: {
        enabled: domain.git?.enabled ?? false,
        url: domain.git?.url,
        branch: domain.git?.branch ?? "main",
        path: domain.git?.path ?? "",
        poll_seconds: domain.git?.poll_seconds ?? 0,
        webhook_secret: domain.git?.webhook_secret,
      },
      raw: domain,
    };
    domains.set(name, resolved);

    const hosts = [name, ...resolved.aliases];
    for (const host of hosts) {
      const key = normalizeHost(host);
      if (hostIndex.has(key) && hostIndex.get(key) !== name) {
        throw new Error(
          `Host "${host}" maps to both "${hostIndex.get(key)}" and "${name}"`,
        );
      }
      hostIndex.set(key, name);
    }
  }

  return {
    listen: {
      host: paths.host ?? DEFAULT_HOST,
      port: paths.port ?? DEFAULT_PORT,
    },
    domainsDir,
    gitCacheDir,
    domains,
    hostIndex,
    configPath: paths.configPath,
  };
}

/** Strip port and lowercase the Host header / config hostname */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end !== -1) {
      h = h.slice(0, end + 1);
      return h;
    }
  }
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) {
    h = h.slice(0, colon);
  }
  return h;
}

export function loadConfig(paths?: RuntimePaths): ResolvedConfig {
  const runtime = paths ?? resolveRuntimePaths();
  const raw = loadRawConfig(runtime.configPath);
  return resolveConfig(raw, runtime);
}
