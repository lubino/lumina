import type { ResolvedConfig } from "../config/types";
import { logger } from "../logging/logger";
import { ensureGitDomain } from "./manager";

export type PollReload = (domainNames: string[]) => Promise<void>;

/**
 * Per-domain interval pollers. poll_seconds <= 0 means disabled (default).
 */
export class GitPoller {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private getConfig: () => ResolvedConfig,
    private onSynced: PollReload,
  ) {}

  restart(config: ResolvedConfig): void {
    this.stop();
    for (const domain of config.domains.values()) {
      if (!domain.git.enabled) continue;
      const sec = domain.git.poll_seconds ?? 0;
      if (sec <= 0) continue;

      const name = domain.name;
      const ms = sec * 1000;
      logger.info("Git poll enabled", { domain: name, poll_seconds: sec });
      const id = setInterval(() => {
        void this.tick(name);
      }, ms);
      if (typeof id === "object" && id && "unref" in id) {
        (id as NodeJS.Timeout).unref?.();
      }
      this.timers.set(name, id);
    }
  }

  stop(): void {
    for (const id of this.timers.values()) {
      clearInterval(id);
    }
    this.timers.clear();
  }

  private async tick(domainName: string): Promise<void> {
    const config = this.getConfig();
    const domain = config.domains.get(domainName);
    if (!domain?.git.enabled) return;
    try {
      logger.debug("Git poll tick", { domain: domainName });
      await ensureGitDomain(config, domain);
      await this.onSynced([domainName]);
    } catch (err) {
      logger.error("Git poll failed", {
        domain: domainName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
