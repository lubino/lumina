import { createApp, type LuminaApp } from "../app";
import {
  loadConfig,
  resolveRuntimePaths,
  type RuntimePaths,
} from "../config/load";
import type { ResolvedConfig, ResolvedDomain } from "../config/types";
import { watchConfigFile } from "../config/watch";
import { GitWebhookCoalescer } from "../git/coalesce";
import { syncAllGitDomains } from "../git/manager";
import { GitPoller } from "../git/poll";
import {
  runGitSyncForTargets,
  takePendingWebhookTargets,
} from "../git/webhook";
import { logger } from "../logging/logger";
import { createDebouncedWatcher } from "../watch/fs-watcher";

export interface LuminaServer {
  app: LuminaApp;
  config: ResolvedConfig;
  paths: RuntimePaths;
  server: ReturnType<typeof Bun.serve>;
  stop: () => void;
}

export interface StartOptions {
  paths?: RuntimePaths;
  /** Skip filesystem watchers (useful in tests) */
  watch?: boolean;
  /** Skip git sync on start */
  syncGit?: boolean;
  /** Skip git poll intervals */
  gitPoll?: boolean;
  /** Override port (tests) */
  port?: number;
  hostname?: string;
  /** Cooldown for webhook coalesce (tests); default 5 minutes */
  gitWebhookCooldownMs?: number;
}

export async function startLuminaServer(
  options: StartOptions = {},
): Promise<LuminaServer> {
  const paths = options.paths ?? resolveRuntimePaths();
  let config = loadConfig(paths);

  if (options.syncGit !== false) {
    await syncAllGitDomains(config);
    config = loadConfig(paths);
  }

  const app = createApp(config);
  await app.init();

  const getConfig = () => app.getConfig();

  // Holder so the runner can call takePendingWebhookTargets(coalescer)
  const box: { coalescer: GitWebhookCoalescer | null } = { coalescer: null };

  const coalescer = new GitWebhookCoalescer(async () => {
    const cfg = getConfig();
    const c = box.coalescer;
    const pending = c ? takePendingWebhookTargets(c) : undefined;
    const targets: ResolvedDomain[] | "all" =
      pending && pending.length > 0
        ? pending
            .map((d) => cfg.domains.get(d.name))
            .filter((d): d is ResolvedDomain => !!d && d.git.enabled)
        : "all";

    const synced = await runGitSyncForTargets(cfg, targets);
    for (const d of synced) {
      await app.reloadDomainRoutes(d.name);
    }
  }, options.gitWebhookCooldownMs);

  box.coalescer = coalescer;

  app.setGitWebhook({ coalescer });

  const poller = new GitPoller(getConfig, async (names) => {
    for (const name of names) {
      await app.reloadDomainRoutes(name);
    }
  });
  if (options.gitPoll !== false) {
    poller.restart(config);
  }

  const port = options.port ?? config.listen.port;
  const hostname = options.hostname ?? config.listen.host;

  const server = Bun.serve({
    port,
    hostname,
    fetch: (req) => app.fetch(req),
    error(err) {
      logger.error("Unhandled server error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  logger.info("Lumina listening", {
    url: `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${server.port}`,
    config: paths.configPath,
    domains: [...config.domains.keys()],
    hosts: [...config.hostIndex.keys()],
    gitWebhook: "/_lumina/hooks/git",
  });

  const closers: Array<() => void> = [];
  closers.push(() => {
    coalescer.stop();
    poller.stop();
  });

  if (options.watch !== false) {
    const contentWatch = createContentWatchers(app);
    contentWatch.start(config);
    closers.push(() => contentWatch.stop());

    const configWatcher = watchConfigFile(paths, async () => {
      if (options.syncGit !== false) {
        const provisional = loadConfig(paths);
        await syncAllGitDomains(provisional);
      }
      const reloaded = loadConfig(paths);
      await app.applyConfig(reloaded);
      contentWatch.restart(reloaded);
      if (options.gitPoll !== false) {
        poller.restart(reloaded);
      }
      logger.info("Applied config hot-reload", {
        domains: [...reloaded.domains.keys()],
      });
    });
    closers.push(() => configWatcher.close());
  }

  return {
    app,
    get config() {
      return app.getConfig();
    },
    paths,
    server,
    stop() {
      for (const c of closers) c();
      server.stop(true);
    },
  };
}

function createContentWatchers(app: LuminaApp) {
  let closer: (() => void) | null = null;

  return {
    start(config: ResolvedConfig) {
      this.restart(config);
    },
    restart(config: ResolvedConfig) {
      if (closer) closer();
      const roots = [...config.domains.values()].map((d) => d.root);
      const unique = [...new Set(roots)];
      const watcher = createDebouncedWatcher(
        unique,
        async (_event, filename) => {
          logger.debug("Content change", { filename });
          await app.reloadDomainRoutes();
        },
        120,
      );
      closer = () => watcher.close();
    },
    stop() {
      if (closer) closer();
      closer = null;
    },
  };
}
