import { basename } from "node:path";
import { pathSegments, urlPathSegments } from "./path-safe";

/** Directory path segments that must never be served (case-insensitive). */
export const BLOCKED_DIR_SEGMENTS = new Set(
  [
    ".git",
    ".svn",
    ".hg",
    ".bzr",
    "node_modules",
    ".npm",
    ".yarn",
    ".pnpm-store",
    ".bun",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".tox",
    "target",
    "git-cache",
    ".ssh",
    ".gnupg",
    ".github",
    ".gitlab",
    ".circleci",
    ".cursor",
    ".grok",
    // common build caches (content under dist may be intentional — still blocked by default)
    ".next",
    ".nuxt",
    ".output",
    ".turbo",
  ].map((s) => s.toLowerCase()),
);

/** Exact basenames that must never be served (case-insensitive). */
export const BLOCKED_BASENAMES = new Set(
  [
    "agents.md",
    "claude.md",
    "gemini.md",
    "codex.md",
    ".cursorrules",
    ".env",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "composer.json",
    "composer.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
    "pipfile",
    "pipfile.lock",
    "poetry.lock",
    "pyproject.toml",
    "requirements.txt",
    "tsconfig.json",
    "jsconfig.json",
    "config.yaml",
    "config.yml",
    "makefile",
    ".htaccess",
    ".htpasswd",
    "web.config",
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
  ].map((s) => s.toLowerCase()),
);

const BLOCKED_BASENAME_PREFIXES = [".env."];

const BLOCKED_BASENAME_GLOBS: RegExp[] = [
  /^id_rsa/i,
  /^id_ed25519/i,
  /^docker-compose/i,
  /^dockerfile/i,
  /^webpack\.config\./i,
  /^vite\.config\./i,
  /^rollup\.config\./i,
  /^eslint\.config\./i,
  /^\.eslintrc/i,
  /^prettier\.config\./i,
  /^\.prettierrc/i,
  /^npm-debug\.log/i,
  /^yarn-error\.log/i,
];

const BLOCKED_EXTENSIONS = new Set(
  [".pem", ".key", ".p12", ".pfx", ".keystore", ".log"].map((s) =>
    s.toLowerCase(),
  ),
);

/** Only this hidden directory is allowed through the "dot segment" policy. */
const DOT_SEGMENT_ALLOWLIST = new Set([".well-known"]);

export interface DenyCheckResult {
  denied: boolean;
  reason?: string;
}

/**
 * Check whether a request URL path should be denied before filesystem access.
 */
export function isDeniedUrlPath(pathname: string): DenyCheckResult {
  const segments = urlPathSegments(pathname);
  return checkSegmentsAndBasename(segments, segments.at(-1));
}

/**
 * Check a resolved absolute filesystem path (relative segments from domain root preferred).
 * Pass the path relative to domain root when possible.
 */
export function isDeniedFsPath(relativeOrAbsolutePath: string): DenyCheckResult {
  const segments = pathSegments(relativeOrAbsolutePath);
  const base = basename(relativeOrAbsolutePath);
  return checkSegmentsAndBasename(segments, base);
}

function checkSegmentsAndBasename(
  segments: string[],
  base: string | undefined,
): DenyCheckResult {
  for (const seg of segments) {
    const lower = seg.toLowerCase();

    if (BLOCKED_DIR_SEGMENTS.has(lower)) {
      return { denied: true, reason: `blocked directory segment: ${seg}` };
    }

    // Hidden segment policy (dotfiles / dot-dirs), with allowlist
    if (seg.startsWith(".") && !DOT_SEGMENT_ALLOWLIST.has(lower)) {
      return { denied: true, reason: `hidden path segment: ${seg}` };
    }
  }

  if (base) {
    const baseLower = base.toLowerCase();

    if (BLOCKED_BASENAMES.has(baseLower)) {
      return { denied: true, reason: `blocked file: ${base}` };
    }

    for (const prefix of BLOCKED_BASENAME_PREFIXES) {
      if (baseLower.startsWith(prefix)) {
        return { denied: true, reason: `blocked file prefix: ${base}` };
      }
    }

    for (const re of BLOCKED_BASENAME_GLOBS) {
      if (re.test(base)) {
        return { denied: true, reason: `blocked file pattern: ${base}` };
      }
    }

    const extMatch = baseLower.match(/\.[a-z0-9.]+$/i);
    if (extMatch) {
      // multi-suffix like .tar.gz — check last extension only for deny list
      const lastDot = baseLower.lastIndexOf(".");
      if (lastDot >= 0) {
        const ext = baseLower.slice(lastDot);
        if (BLOCKED_EXTENSIONS.has(ext)) {
          return { denied: true, reason: `blocked extension: ${ext}` };
        }
      }
    }
  }

  return { denied: false };
}
