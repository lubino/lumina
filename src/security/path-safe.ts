import { resolve, relative, normalize, isAbsolute, sep } from "node:path";

/**
 * Resolve a request URL path against a domain root and ensure it cannot escape.
 * Returns absolute path or null if the path is invalid / escapes the root.
 */
export function resolveSafePath(
  domainRoot: string,
  requestPath: string,
): string | null {
  const root = resolve(domainRoot);

  // Decode carefully; reject null bytes
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }

  // Strip leading slashes; treat as relative to domain root
  const stripped = decoded.replace(/^\/+/, "");
  // Collapse . and .. segments
  const normalizedRel = normalize(stripped);

  // If normalize still leaves parent segments at the start, reject
  if (
    normalizedRel === ".." ||
    normalizedRel.startsWith(`..${sep}`) ||
    normalizedRel.startsWith("../")
  ) {
    return null;
  }

  const candidate = resolve(root, normalizedRel === "." ? "" : normalizedRel);
  const rel = relative(root, candidate);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }

  // Extra guard: resolved path must stay under root
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }

  return candidate;
}

/**
 * Split a filesystem path into segments (no empty parts).
 */
export function pathSegments(filePath: string): string[] {
  return filePath.split(/[/\\]+/).filter(Boolean);
}

/**
 * URL pathname segments without leading empty.
 */
export function urlPathSegments(pathname: string): string[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return [];
  }
  return decoded.split("/").filter(Boolean);
}
