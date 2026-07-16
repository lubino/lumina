import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Hono } from "hono";
import type { ResolvedDomain } from "../config/types";
import { logger } from "../logging/logger";
import { isDeniedFsPath } from "../security/deny-paths";

export type RouteHandler = (
  request: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

interface LoadedRoute {
  /** URL path pattern like /api or /users/:id */
  pattern: string;
  filePath: string;
  handler: RouteHandler;
  /** Specificity: higher = more static segments (for matching order) */
  score: number;
}

const ROUTE_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".mts", ".mjs"]);

function walkRouteFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith(".")) continue;
    if (isDeniedFsPath(entry).denied) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkRouteFiles(full, base));
    } else if (st.isFile()) {
      const ext = extname(entry);
      if (ROUTE_EXTS.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

function extname(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/**
 * Convert routes/users/[id].ts → /users/:id
 * routes/api.ts → /api
 * routes/index.ts → /
 * routes/blog/[[...slug]].ts → /blog/*
 */
export function fileToRoutePattern(routesRoot: string, filePath: string): string {
  let rel = relative(routesRoot, filePath).split(sep).join("/");
  rel = rel.replace(/\.(ts|tsx|js|jsx|mts|mjs|cjs|cts)$/i, "");
  if (rel === "index" || rel.endsWith("/index")) {
    rel = rel.replace(/\/?index$/, "");
  }
  const parts = rel.split("/").filter(Boolean);
  const mapped = parts.map((part) => {
    // optional catch-all [[...slug]]
    const optCatch = part.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optCatch) return `*:${optCatch[1]}`;
    const catchAll = part.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) return `*:${catchAll[1]}`;
    const dyn = part.match(/^\[(.+)\]$/);
    if (dyn) return `:${dyn[1]}`;
    return part;
  });
  return "/" + mapped.join("/");
}

function patternScore(pattern: string): number {
  if (pattern === "/") return 0;
  const segs = pattern.split("/").filter(Boolean);
  let score = segs.length * 10;
  for (const s of segs) {
    if (s.startsWith("*:")) score -= 5;
    else if (s.startsWith(":")) score -= 2;
    else score += 3;
  }
  return score;
}

/** Match a pathname against an internal pattern; returns params or null. */
export function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const pSegs = pattern.split("/").filter(Boolean);
  const uSegs = pathname.split("/").filter(Boolean);

  // Exact root
  if (pSegs.length === 0) {
    return uSegs.length === 0 ? {} : null;
  }

  const params: Record<string, string> = {};
  let ui = 0;

  for (let pi = 0; pi < pSegs.length; pi++) {
    const p = pSegs[pi]!;
    if (p.startsWith("*:")) {
      const name = p.slice(2);
      const rest = uSegs.slice(ui);
      // optional catch-all may be empty only if last pattern segment
      params[name] = rest.join("/");
      ui = uSegs.length;
      // remaining pattern segs not allowed after catch-all
      if (pi !== pSegs.length - 1) return null;
      return params;
    }
    if (ui >= uSegs.length) return null;
    const u = uSegs[ui]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(u);
      ui++;
      continue;
    }
    if (p !== u) return null;
    ui++;
  }

  if (ui !== uSegs.length) return null;
  return params;
}

async function loadHandler(filePath: string): Promise<RouteHandler | null> {
  try {
    // Cache-bust for hot reload
    const mod = await import(`${filePath}?t=${Date.now()}`);
    const exported = mod.default ?? mod.app ?? mod.handler ?? mod.fetch;

    if (typeof exported === "function") {
      // Could be (req) => Response or Hono-like fetch
      return async (request, params) => {
        // Hono apps are objects with fetch; plain functions get request
        if (exported.length >= 1) {
          // Attach params for user handlers via header/custom — pass as second arg if accepted
          try {
            const result = await exported(request, params);
            if (result instanceof Response) return result;
            if (result && typeof result === "object" && "fetch" in result) {
              return (result as { fetch: typeof fetch }).fetch(request);
            }
          } catch {
            // try single-arg
          }
        }
        const result = await exported(request);
        if (result instanceof Response) return result;
        return new Response(JSON.stringify(result ?? null), {
          headers: { "Content-Type": "application/json" },
        });
      };
    }

    if (exported instanceof Hono) {
      return (request) => exported.fetch(request);
    }

    if (exported && typeof exported === "object" && "fetch" in exported) {
      const fetchable = exported as { fetch: (req: Request) => Response | Promise<Response> };
      return (request) => fetchable.fetch(request);
    }

    logger.warn("Route module has no usable export", { filePath });
    return null;
  } catch (err) {
    logger.error("Failed to load route module", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export class DomainRouteTable {
  private routes: LoadedRoute[] = [];
  private routesRoot: string;

  constructor(private domain: ResolvedDomain) {
    this.routesRoot = join(domain.root, domain.routesDir);
  }

  async reload(): Promise<void> {
    const files = walkRouteFiles(this.routesRoot);
    const loaded: LoadedRoute[] = [];

    for (const filePath of files) {
      const pattern = fileToRoutePattern(this.routesRoot, filePath);
      const handler = await loadHandler(filePath);
      if (!handler) continue;
      loaded.push({
        pattern,
        filePath,
        handler,
        score: patternScore(pattern),
      });
    }

    loaded.sort((a, b) => b.score - a.score);
    this.routes = loaded;
    logger.debug("Routes loaded", {
      domain: this.domain.name,
      count: loaded.length,
      patterns: loaded.map((r) => r.pattern),
    });
  }

  async handle(request: Request, pathname: string): Promise<Response | null> {
    for (const route of this.routes) {
      const params = matchPattern(route.pattern, pathname);
      if (params) {
        return route.handler(request, params);
      }
    }
    return null;
  }

  listPatterns(): string[] {
    return this.routes.map((r) => r.pattern);
  }
}

export function createRouteTable(domain: ResolvedDomain): DomainRouteTable {
  return new DomainRouteTable(domain);
}
