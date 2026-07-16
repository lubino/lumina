#!/usr/bin/env bun
import { startLuminaServer } from "./server/lifecycle";
import { logger } from "./logging/logger";

async function main() {
  const server = await startLuminaServer({
    watch: process.env.LUMINA_WATCH !== "0",
    syncGit: process.env.LUMINA_SYNC_GIT !== "0",
  });

  const shutdown = () => {
    logger.info("Shutting down…");
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
