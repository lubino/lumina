import { createDebouncedWatcher } from "../watch/fs-watcher";
import { logger } from "../logging/logger";
import { loadConfig, type RuntimePaths } from "./load";
import type { ResolvedConfig } from "./types";

export function watchConfigFile(
  paths: RuntimePaths,
  onReload: (config: ResolvedConfig) => void | Promise<void>,
): { close: () => void } {
  return createDebouncedWatcher(
    [paths.configPath],
    async () => {
      try {
        const config = loadConfig(paths);
        logger.info("Config reloaded", { path: paths.configPath });
        await onReload(config);
      } catch (err) {
        logger.error("Config reload failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    150,
  );
}
