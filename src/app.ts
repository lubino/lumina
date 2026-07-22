import type { ResolvedConfig, ResolvedDomain } from "./config/types";
import { DYNAMIC_CACHE_CONTROL_DEFAULT } from "./caching/http-cache";
import type { GitWebhookCoalescer } from "./git/coalesce";
import { GIT_WEBHOOK_PATH, handleGitWebhook } from "./git/webhook";
import { logger } from "./logging/logger";
import { resolveDomainFromRequest } from "./routing/domain-resolver";
import { createRouteTable, type DomainRouteTable } from "./routing/dynamic";
import { serveStaticFile } from "./routing/static";
import { renderUnknownHostPage } from "./routing/unknown-host";

export interface GitWebhookDeps {
  coalescer: GitWebhookCoalescer;
}

export class LuminaApp {
  private routeTables = new Map<string, DomainRouteTable>();
  private gitWebhook: GitWebhookDeps | null = null;

  constructor(private config: ResolvedConfig) {}

  getConfig(): ResolvedConfig {
    return this.config;
  }

  /** Wire webhook coalescer (call from lifecycle after construct). */
  setGitWebhook(deps: GitWebhookDeps | null): void {
    this.gitWebhook = deps;
  }

  async init(): Promise<void> {
    await this.rebuildRoutes(this.config);
  }

  async applyConfig(config: ResolvedConfig): Promise<void> {
    this.config = config;
    await this.rebuildRoutes(config);
  }

  async reloadDomainRoutes(domainName?: string): Promise<void> {
    if (domainName) {
      const domain = this.config.domains.get(domainName);
      if (!domain) return;
      const table = createRouteTable(domain);
      await table.reload();
      this.routeTables.set(domainName, table);
      return;
    }
    await this.rebuildRoutes(this.config);
  }

  private async rebuildRoutes(config: ResolvedConfig): Promise<void> {
    const next = new Map<string, DomainRouteTable>();
    for (const domain of config.domains.values()) {
      const table = createRouteTable(domain);
      await table.reload();
      next.set(domain.name, table);
    }
    this.routeTables = next;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Global control plane — not virtual-hosted
    if (
      url.pathname === GIT_WEBHOOK_PATH ||
      url.pathname === `${GIT_WEBHOOK_PATH}/`
    ) {
      return this.handleGitWebhookRequest(request);
    }

    const { domain, hostInfo } = resolveDomainFromRequest(this.config, request);

    if (!domain) {
      return renderUnknownHostPage({
        config: this.config,
        request,
        hostInfo,
      });
    }

    const pathname = url.pathname;

    const table = this.routeTables.get(domain.name);
    if (table) {
      try {
        const dynamic = await table.handle(request, pathname);
        if (dynamic) {
          return withDomainHeaders(
            ensureDynamicCacheDefault(dynamic),
            domain,
            hostInfo.host,
          );
        }
      } catch (err) {
        logger.error("Dynamic route error", {
          domain: domain.name,
          path: pathname,
          error: err instanceof Error ? err.message : String(err),
        });
        return json({ error: "Route handler error" }, 500);
      }
    }

    const staticResponse = await serveStaticFile(
      domain.root,
      pathname,
      request,
    );
    if (staticResponse) {
      return withDomainHeaders(staticResponse, domain, hostInfo.host);
    }

    return json(
      { error: "Not Found", path: pathname, domain: domain.name },
      404,
    );
  }

  private async handleGitWebhookRequest(request: Request): Promise<Response> {
    if (!this.gitWebhook) {
      return json({ error: "Git webhook not configured" }, 503);
    }
    return handleGitWebhook(request, this.config, this.gitWebhook.coalescer);
  }
}

/**
 * Dynamic routes are not filesystem-stable. If the handler omitted
 * Cache-Control, default to private no-store so CDNs never treat them as
 * long-lived static assets. Explicit handler headers always win.
 */
function ensureDynamicCacheDefault(response: Response): Response {
  if (response.headers.has("Cache-Control")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", DYNAMIC_CACHE_CONTROL_DEFAULT);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withDomainHeaders(
  response: Response,
  domain: ResolvedDomain,
  resolvedHost: string | null,
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Lumina-Domain", domain.name);
  if (resolvedHost) {
    headers.set("X-Lumina-Host", resolvedHost);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createApp(config: ResolvedConfig): LuminaApp {
  return new LuminaApp(config);
}
