import type { DomainConfig } from "./schema";

export interface ResolvedDomain {
  /** Canonical domain key from config (e.g. example.com) */
  name: string;
  /** Absolute filesystem root used for static + routes */
  root: string;
  aliases: string[];
  routesDir: string;
  git: {
    enabled: boolean;
    url?: string;
    branch: string;
    path: string;
    /** 0 = no periodic poll (default) */
    poll_seconds: number;
    /** Per-domain webhook secret (unique per repo entry in YAML) */
    webhook_secret?: string;
  };
  /** Original domain config entry */
  raw: DomainConfig;
}

export interface ResolvedConfig {
  /** Bind settings — always from env / defaults, never YAML */
  listen: {
    host: string;
    port: number;
  };
  domainsDir: string;
  gitCacheDir: string;
  /** Canonical domain name → resolved domain */
  domains: Map<string, ResolvedDomain>;
  /** host (lowercase) → canonical domain name */
  hostIndex: Map<string, string>;
  configPath: string;
}

export interface RuntimePaths {
  configPath: string;
  domainsDir: string;
  gitCacheDir: string;
  /** From LUMINA_HOST when set */
  host?: string;
  /** From LUMINA_PORT when set */
  port?: number;
}
