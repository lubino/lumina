import { normalizeHost } from "../config/load";

export type HostSource =
  | "x-forwarded-host"
  | "forwarded"
  | "x-original-host"
  | "cf-connecting-host"
  | "host"
  | "url"
  | "none";

export interface RequestHostInfo {
  /** Normalized hostname without port (lowercase) */
  host: string | null;
  /** Raw value before normalize (may include port) */
  raw: string | null;
  /** Which header / field provided the host */
  source: HostSource;
  /** All candidates inspected (for diagnostics) */
  candidates: Array<{ source: HostSource; raw: string }>;
}

/**
 * Resolve the public hostname for virtual hosting.
 *
 * Supports reverse proxies and Cloudflare Tunnel (cloudflared), which may pass
 * the browser hostname via X-Forwarded-Host / Forwarded while Host points at
 * the origin (container, localhost, or internal service name).
 *
 * Priority (first non-empty wins):
 * 1. X-Forwarded-Host (first value if comma-separated)
 * 2. Forwarded: host=… (RFC 7239)
 * 3. X-Original-Host
 * 4. Host
 * 5. URL hostname from the request URL
 */
export function resolveRequestHost(request: Request): RequestHostInfo {
  const candidates: Array<{ source: HostSource; raw: string }> = [];

  const xfh = request.headers.get("x-forwarded-host");
  if (xfh) {
    const first = firstForwardedHost(xfh);
    if (first) candidates.push({ source: "x-forwarded-host", raw: first });
  }

  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    const fromFwd = parseForwardedHost(forwarded);
    if (fromFwd) candidates.push({ source: "forwarded", raw: fromFwd });
  }

  const xoh = request.headers.get("x-original-host");
  if (xoh?.trim()) {
    candidates.push({ source: "x-original-host", raw: xoh.trim() });
  }

  // Rare / custom; some tunnel edge configs
  const cfHost = request.headers.get("cf-connecting-host");
  if (cfHost?.trim()) {
    candidates.push({ source: "cf-connecting-host", raw: cfHost.trim() });
  }

  const hostHdr = request.headers.get("host");
  if (hostHdr?.trim()) {
    candidates.push({ source: "host", raw: hostHdr.trim() });
  }

  try {
    const u = new URL(request.url);
    if (u.hostname) {
      candidates.push({ source: "url", raw: u.host });
    }
  } catch {
    // ignore invalid URL
  }

  for (const c of candidates) {
    const host = normalizeHost(c.raw);
    if (host) {
      return {
        host,
        raw: c.raw,
        source: c.source,
        candidates,
      };
    }
  }

  return { host: null, raw: null, source: "none", candidates };
}

function firstForwardedHost(value: string): string | null {
  // "public.example.com, internal:8080" → public.example.com
  const part = value.split(",")[0]?.trim();
  return part || null;
}

/**
 * Parse RFC 7239 Forwarded header for host=…
 * Example: for=1.2.3.4;proto=https;host=app.example.com
 */
export function parseForwardedHost(header: string): string | null {
  // Multiple forwarded entries separated by comma
  for (const entry of header.split(",")) {
    for (const directive of entry.split(";")) {
      const [rawKey, ...rest] = directive.trim().split("=");
      if (!rawKey || rest.length === 0) continue;
      const key = rawKey.trim().toLowerCase();
      if (key !== "host") continue;
      let val = rest.join("=").trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) return val;
    }
  }
  return null;
}
