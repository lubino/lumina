import { statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  fileETag,
  isNotModified,
  STATIC_CACHE_CONTROL,
  toHttpDate,
} from "../caching/http-cache";
import { resolveSafePath } from "../security/path-safe";
import { isDeniedFsPath, isDeniedUrlPath } from "../security/deny-paths";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function contentTypeFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME[lower.slice(dot)] ?? "application/octet-stream";
}

export type StaticResult =
  | { kind: "file"; path: string; contentType: string }
  | { kind: "denied" }
  | { kind: "not_found" };

/**
 * Resolve a static file under domain root. Never returns denied paths.
 * Directory requests try index.html.
 */
export function resolveStaticFile(
  domainRoot: string,
  pathname: string,
): StaticResult {
  if (isDeniedUrlPath(pathname).denied) {
    return { kind: "denied" };
  }

  const safe = resolveSafePath(domainRoot, pathname);
  if (!safe) {
    return { kind: "denied" };
  }

  // Only inspect the path *inside* the domain root. Checking the absolute
  // filesystem path would false-positive deny git-backed sites stored under
  // …/git-cache/<domain>/ (segment "git-cache" is blocked for URL traversal).
  const rel = relative(domainRoot, safe);
  if (isDeniedFsPath(rel).denied) {
    return { kind: "denied" };
  }

  // Do not serve raw TypeScript/JavaScript from routes/ as static source
  const relPosix = rel.split("\\").join("/");
  if (
    (relPosix === "routes" || relPosix.startsWith("routes/")) &&
    /\.(ts|js|tsx|jsx|mts|cts|mjs|cjs)$/i.test(relPosix)
  ) {
    return { kind: "denied" };
  }

  try {
    const st = statSync(safe);
    if (st.isDirectory()) {
      const indexPath = join(safe, "index.html");
      try {
        const ist = statSync(indexPath);
        if (!ist.isFile()) return { kind: "not_found" };
        const indexRel = relative(domainRoot, indexPath);
        if (isDeniedFsPath(indexRel).denied) return { kind: "denied" };
        return {
          kind: "file",
          path: indexPath,
          contentType: contentTypeFor(indexPath),
        };
      } catch {
        return { kind: "not_found" };
      }
    }
    if (!st.isFile()) {
      return { kind: "not_found" };
    }
    return {
      kind: "file",
      path: safe,
      contentType: contentTypeFor(safe),
    };
  } catch {
    // try appending index.html for extensionless paths already handled;
    // also try path as file when trailing slash missing
    return { kind: "not_found" };
  }
}

/**
 * Serve a static file with identity-based cache validators.
 * Clients/CDNs may store the body but must revalidate (max-age=0).
 * Conditional GET/HEAD with matching ETag / If-Modified-Since → 304.
 */
export async function serveStaticFile(
  domainRoot: string,
  pathname: string,
  request?: Request | null,
): Promise<Response | null> {
  const result = resolveStaticFile(domainRoot, pathname);
  if (result.kind === "denied") {
    return new Response("Not Found", { status: 404 });
  }
  if (result.kind === "not_found") {
    return null;
  }

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(result.path);
  } catch {
    return null;
  }
  if (!st.isFile()) {
    return null;
  }

  const etag = fileETag(st.mtimeMs, st.size);
  const lastModified = toHttpDate(st.mtimeMs);
  const commonHeaders: Record<string, string> = {
    ETag: etag,
    "Last-Modified": lastModified,
    "Cache-Control": STATIC_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };

  // Revalidate always: browsers/CDNs keep a copy, ask origin before reuse.
  // Without Cache-Control, Cloudflare often caches static extensions ~4h so
  // git-updated CSS/JS/images stay stale while new paths work immediately.
  if (isNotModified(request, etag, st.mtimeMs)) {
    return new Response(null, {
      status: 304,
      headers: commonHeaders,
    });
  }

  const file = Bun.file(result.path);
  if (!(await file.exists())) {
    return null;
  }

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      ...commonHeaders,
    },
  });
}
