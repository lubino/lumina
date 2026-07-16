import { normalizeHost } from "../config/load";
import type { ResolvedConfig, ResolvedDomain } from "../config/types";
import {
  resolveRequestHost,
  type RequestHostInfo,
} from "./request-host";

export interface DomainResolveResult {
  domain: ResolvedDomain | null;
  hostInfo: RequestHostInfo;
}

/**
 * Resolve the virtual host for a request (reverse-proxy / tunnel aware).
 */
export function resolveDomainFromRequest(
  config: ResolvedConfig,
  request: Request,
): DomainResolveResult {
  const hostInfo = resolveRequestHost(request);

  if (!hostInfo.host) {
    if (config.domains.size === 1) {
      return {
        domain: config.domains.values().next().value ?? null,
        hostInfo,
      };
    }
    return { domain: null, hostInfo };
  }

  const name = config.hostIndex.get(hostInfo.host);
  if (!name) {
    return { domain: null, hostInfo };
  }
  return {
    domain: config.domains.get(name) ?? null,
    hostInfo,
  };
}

/** Resolve by a raw Host string (no proxy header logic). */
export function resolveDomain(
  config: ResolvedConfig,
  hostHeader: string | null | undefined,
): ResolvedDomain | null {
  if (!hostHeader) {
    if (config.domains.size === 1) {
      return config.domains.values().next().value ?? null;
    }
    return null;
  }
  const host = normalizeHost(hostHeader);
  const name = config.hostIndex.get(host);
  if (!name) return null;
  return config.domains.get(name) ?? null;
}

export function listHosts(config: ResolvedConfig): string[] {
  return [...config.hostIndex.keys()].sort();
}
