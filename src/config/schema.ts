import { z } from "zod";

export const GitConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().optional(),
  branch: z.string().default("main"),
  /** Optional subpath inside the cloned repository */
  path: z.string().default(""),
  /**
   * Periodic remote check interval in seconds.
   * 0 (default) = polling disabled for this domain; use webhooks only.
   */
  poll_seconds: z.coerce.number().int().min(0).default(0),
  /**
   * Unique webhook secret for this domain/repo (YAML only — not an env var).
   * Required for POST /_lumina/hooks/git to accept pushes for this domain.
   * Configure the same value on GitHub / GitLab / Forgejo for that repository.
   */
  webhook_secret: z.string().optional(),
});

export const DomainConfigSchema = z.object({
  /** Absolute path or name relative to domains_dir */
  root: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  git: GitConfigSchema.default({ enabled: false }),
  /** Subfolder for dynamic routes (relative to content root) */
  routesDir: z.string().default("routes"),
});

export const PathsConfigSchema = z.object({
  domains_dir: z.string().optional(),
  git_cache_dir: z.string().optional(),
});

/**
 * YAML config: domains + optional paths only.
 * Listen host/port are never in YAML — use LUMINA_HOST / LUMINA_PORT.
 * A top-level `server:` key is rejected (strict schema).
 */
export const ConfigSchema = z
  .object({
    paths: PathsConfigSchema.default({}),
    domains: z.record(z.string(), DomainConfigSchema).default({}),
  })
  .strict();

export type GitConfig = z.infer<typeof GitConfigSchema>;
export type DomainConfig = z.infer<typeof DomainConfigSchema>;
export type RawConfig = z.infer<typeof ConfigSchema>;
