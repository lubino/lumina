import { watch, type FSWatcher } from "node:fs";
import { logger } from "../logging/logger";

export type WatchCallback = (event: string, filename: string | null) => void;

/**
 * Debounced recursive directory/file watcher.
 */
export function createDebouncedWatcher(
  paths: string[],
  onChange: WatchCallback,
  debounceMs = 100,
): { close: () => void } {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEvent = "change";
  let lastFile: string | null = null;

  const fire = (event: string, filename: string | null) => {
    lastEvent = event;
    lastFile = filename;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange(lastEvent, lastFile);
    }, debounceMs);
  };

  for (const p of paths) {
    try {
      const w = watch(p, { recursive: true }, (event, filename) => {
        fire(event, filename?.toString() ?? null);
      });
      w.on("error", (err) => {
        logger.warn("Watcher error", { path: p, error: String(err) });
      });
      watchers.push(w);
    } catch (err) {
      logger.warn("Could not watch path", {
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}
