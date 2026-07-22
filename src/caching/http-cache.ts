/**
 * HTTP cache helpers for static responses (ETag / Last-Modified / conditionals).
 * File identity: content hash (small files) or mtime+size (large). Meta cache in static-meta.ts.
 */

import { createHash } from "node:crypto";

/** Max file size to read for a content-hash ETag (and optional body cache seed). */
export const CONTENT_HASH_MAX_BYTES = 256 * 1024;

/** Max single entry stored in the in-memory body cache. */
export const BODY_CACHE_MAX_ENTRY_BYTES = 64 * 1024;

/** Total body-cache budget per LuminaApp (bytes). */
export const BODY_CACHE_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Static-file default: store + always revalidate (CDN-friendly, git-safe). */
export const STATIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * Fingerprinted asset URLs only (content hash in the filename).
 * Safe for year-long shared caching; content change implies a new URL.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Default for dynamic routes when the handler did not set Cache-Control. */
export const DYNAMIC_CACHE_CONTROL_DEFAULT = "private, no-store";

/** Extensions eligible for immutable long-cache when the basename is fingerprinted. */
const IMMUTABLE_EXTS = new Set([
  "js",
  "mjs",
  "cjs",
  "css",
  "map",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "avif",
  "wasm",
]);

/**
 * True when the URL basename looks fingerprinted with a content-style hash
 * (≥8 chars, hex or alnum with a digit) and a static asset extension.
 *
 * Supported shapes (HTML never matches):
 * - `name.<hash>.<ext>`  (webpack / many bundlers)
 * - `name-<hash>.<ext>`  (Vite)
 */
export function isFingerprintedPathname(pathname: string): boolean {
  const raw = pathname.split("?")[0] ?? pathname;
  const base = decodeURIComponent(raw.split("/").pop() ?? "");

  // name.hash.ext
  const dotted = base.match(
    /^(.+)\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9]+)$/,
  );
  if (dotted && looksLikeContentHash(dotted[2]!, dotted[3]!)) return true;

  // name-hash.ext (Vite)
  const dashed = base.match(/^(.+)-([A-Za-z0-9]{8,})\.([A-Za-z0-9]+)$/);
  if (dashed && looksLikeContentHash(dashed[2]!, dashed[3]!)) return true;

  return false;
}

function looksLikeContentHash(hash: string, ext: string): boolean {
  if (!IMMUTABLE_EXTS.has(ext.toLowerCase())) return false;
  if (hash.length < 8) return false;
  if (/^[a-f0-9]+$/i.test(hash)) return true;
  // base64url-ish / vite: require a digit to reduce false positives
  return /[0-9]/.test(hash);
}

export function cacheControlForPathname(pathname: string): string {
  return isFingerprintedPathname(pathname)
    ? IMMUTABLE_CACHE_CONTROL
    : STATIC_CACHE_CONTROL;
}

/** Strong ETag from filesystem identity (mtime ms + size) — large files. */
export function fileETag(mtimeMs: number, size: number): string {
  const m = Math.trunc(mtimeMs).toString(16);
  const s = size.toString(16);
  return `"${m}-${s}"`;
}

/** Strong ETag from content (SHA-256 truncated) — small files. */
export function contentHashETag(data: Uint8Array | Buffer): string {
  const hex = createHash("sha256").update(data).digest("hex").slice(0, 16);
  return `"h${hex}"`;
}

/** RFC 7231 / 9110 HTTP-date (IMF-fix). */
export function toHttpDate(ms: number): string {
  return new Date(ms).toUTCString();
}

/**
 * True if If-None-Match matches the current entity tag.
 * Supports `*`, comma-separated lists, and weak tags (W/"…").
 */
export function etagMatches(
  ifNoneMatch: string | null | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch == null) return false;
  const raw = ifNoneMatch.trim();
  if (!raw) return false;
  if (raw === "*") return true;

  const current = normalizeEtag(etag);
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (!candidate) continue;
    if (normalizeEtag(candidate) === current) return true;
  }
  return false;
}

function normalizeEtag(tag: string): string {
  const t = tag.trim();
  if (t.startsWith("W/") || t.startsWith("w/")) {
    return t.slice(2).trim();
  }
  return t;
}

/**
 * True if the resource has not been modified since If-Modified-Since.
 * Compares at second resolution (HTTP-date has no sub-second precision).
 * Invalid dates never match.
 */
export function notModifiedSince(
  ifModifiedSince: string | null | undefined,
  mtimeMs: number,
): boolean {
  if (ifModifiedSince == null) return false;
  const since = Date.parse(ifModifiedSince);
  if (Number.isNaN(since)) return false;
  const mtimeSec = Math.floor(mtimeMs / 1000) * 1000;
  return mtimeSec <= since;
}

/**
 * Decide 304 vs full body for a GET/HEAD static response.
 * If-None-Match takes precedence over If-Modified-Since (RFC 9110).
 */
export function isNotModified(
  request: Request | null | undefined,
  etag: string,
  mtimeMs: number,
): boolean {
  if (!request) return false;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;

  const inm = request.headers.get("If-None-Match");
  if (inm != null && inm.trim() !== "") {
    return etagMatches(inm, etag);
  }

  return notModifiedSince(request.headers.get("If-Modified-Since"), mtimeMs);
}

export function isHeadRequest(request: Request | null | undefined): boolean {
  return request?.method.toUpperCase() === "HEAD";
}
