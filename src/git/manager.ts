import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeDomainKey } from "../config/load";
import type { ResolvedConfig, ResolvedDomain } from "../config/types";
import { logger } from "../logging/logger";

async function runGit(
  args: string[],
  cwd?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Avoid interactive prompts
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, stdout, stderr };
}

export function gitCachePath(config: ResolvedConfig, domain: ResolvedDomain): string {
  return join(config.gitCacheDir, sanitizeDomainKey(domain.name));
}

export async function ensureGitDomain(
  config: ResolvedConfig,
  domain: ResolvedDomain,
): Promise<void> {
  if (!domain.git.enabled) return;
  if (!domain.git.url) {
    logger.warn("Git enabled but no url for domain", { domain: domain.name });
    return;
  }

  mkdirSync(config.gitCacheDir, { recursive: true });
  const target = gitCachePath(config, domain);
  const branch = domain.git.branch || "main";

  if (!existsSync(join(target, ".git"))) {
    logger.info("Cloning git domain", {
      domain: domain.name,
      url: domain.git.url,
      branch,
      target,
    });
    mkdirSync(target, { recursive: true });
    const clone = await runGit([
      "clone",
      "--depth",
      "1",
      "--branch",
      branch,
      domain.git.url,
      target,
    ]);
    if (!clone.ok) {
      // retry without --branch in case default branch differs
      const fallback = await runGit([
        "clone",
        "--depth",
        "1",
        domain.git.url,
        target,
      ]);
      if (!fallback.ok) {
        throw new Error(
          `git clone failed for ${domain.name}: ${clone.stderr || fallback.stderr}`,
        );
      }
      await runGit(["checkout", branch], target);
    }
    return;
  }

  logger.info("Pulling git domain", { domain: domain.name, branch });
  await runGit(["fetch", "origin", branch], target);
  const checkout = await runGit(["checkout", branch], target);
  if (!checkout.ok) {
    logger.warn("git checkout failed", {
      domain: domain.name,
      stderr: checkout.stderr,
    });
  }
  const pull = await runGit(["pull", "--ff-only", "origin", branch], target);
  if (!pull.ok) {
    logger.warn("git pull failed", {
      domain: domain.name,
      stderr: pull.stderr,
    });
  }
}

export async function syncAllGitDomains(config: ResolvedConfig): Promise<void> {
  for (const domain of config.domains.values()) {
    if (!domain.git.enabled) continue;
    try {
      await ensureGitDomain(config, domain);
    } catch (err) {
      logger.error("Git sync failed", {
        domain: domain.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
