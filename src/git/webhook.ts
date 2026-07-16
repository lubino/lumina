import { createHmac, timingSafeEqual } from "node:crypto";
import type { ResolvedConfig, ResolvedDomain } from "../config/types";
import { logger } from "../logging/logger";
import type { GitWebhookCoalescer } from "./coalesce";
import { ensureGitDomain } from "./manager";
import {
  branchFromRef,
  extractRepoUrlsFromWebhookPayload,
  gitUrlsMatch,
} from "./url-match";

export const GIT_WEBHOOK_PATH = "/_lumina/hooks/git";

/**
 * POST /_lumina/hooks/git
 *
 * Git push webhook receiver for GitHub, GitLab, and Forgejo/Gitea.
 *
 * Rate-limit / coalesce behaviour (5-minute window, see GitWebhookCoalescer):
 * - If this endpoint has not been called for at least 5 minutes (or never),
 *   the git sync logic runs immediately.
 * - If it was called within the last 5 minutes, a single timer is started to
 *   run the same sync after 5 minutes; all further requests until that timer
 *   fires are ignored (no extra timers, no immediate run).
 * - If a sync is already in progress and a concurrent request arrives, that
 *   request is treated as “too soon”: a follow-up timer is set for 5 minutes
 *   so the poll/sync logic runs again after that delay.
 *
 * Auth: each git-backed domain has its own unique `git.webhook_secret` in YAML.
 * The request must verify against that domain’s secret (GitHub
 * X-Hub-Signature-256, GitLab X-Gitlab-Token, Gitea/Forgejo signature, or
 * X-Lumina-Webhook-Secret). Domains without a secret cannot be triggered via
 * this endpoint.
 *
 * Path is global (not Host-virtual-hosted). Register this URL on each forge
 * with the same secret as in that domain’s YAML entry.
 */
export async function handleGitWebhook(
  request: Request,
  config: ResolvedConfig,
  coalescer: GitWebhookCoalescer,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed", allow: "POST" },
      405,
      { Allow: "POST" },
    );
  }

  const rawBody = await request.text();

  let body: unknown = null;
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
  }

  // Non-push events: acknowledge without syncing
  if (isIgnorableEvent(request, body)) {
    return json({ ok: true, action: "ignored_event" }, 202);
  }

  const authorized = domainsAuthorizedBySecret(config, request, rawBody);
  if (authorized.length === 0) {
    logger.warn("Git webhook rejected: no domain secret matched");
    return json({ error: "Unauthorized" }, 401);
  }

  const targets = filterDomainsForPayload(authorized, body);
  if (targets.length === 0) {
    // Valid secret but repo/branch does not match that domain entry
    return json(
      {
        ok: true,
        action: "ignored_no_matching_domain",
        hint: "Secret OK but no domain matched repository URL/branch",
      },
      202,
    );
  }

  // Must set before request() — immediate runs may start before this returns
  pendingWebhookTargets.set(coalescer, targets);
  const coalesce = coalescer.request();

  logger.info("Git webhook accepted", {
    action: coalesce.action,
    domains: targets.map((d) => d.name),
  });

  return json(
    {
      ok: true,
      action: coalesce.action,
      domains: targets.map((d) => d.name),
      running: coalesce.running,
      scheduled: coalesce.scheduled,
    },
    coalesce.action === "started" ? 200 : 202,
  );
}

/** Domains selected by the last webhook hit for a coalescer (best-effort). */
const pendingWebhookTargets = new WeakMap<
  GitWebhookCoalescer,
  ResolvedDomain[]
>();

export function takePendingWebhookTargets(
  coalescer: GitWebhookCoalescer,
): ResolvedDomain[] | undefined {
  const t = pendingWebhookTargets.get(coalescer);
  pendingWebhookTargets.delete(coalescer);
  return t;
}

export async function runGitSyncForTargets(
  config: ResolvedConfig,
  domains: ResolvedDomain[] | "all",
  onAfterSync?: (synced: ResolvedDomain[]) => Promise<void>,
): Promise<ResolvedDomain[]> {
  const list =
    domains === "all"
      ? [...config.domains.values()].filter((d) => d.git.enabled)
      : domains.filter((d) => d.git.enabled);

  const synced: ResolvedDomain[] = [];
  for (const domain of list) {
    try {
      await ensureGitDomain(config, domain);
      synced.push(domain);
    } catch (err) {
      logger.error("Git sync failed", {
        domain: domain.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (onAfterSync && synced.length > 0) {
    await onAfterSync(synced);
  }
  return synced;
}

/**
 * Domains whose per-entry webhook_secret validates this request.
 */
export function domainsAuthorizedBySecret(
  config: ResolvedConfig,
  request: Request,
  rawBody: string,
): ResolvedDomain[] {
  const out: ResolvedDomain[] = [];
  for (const domain of config.domains.values()) {
    if (!domain.git.enabled) continue;
    const secret = domain.git.webhook_secret?.trim();
    if (!secret) continue;
    if (verifyWebhookSecret(request, rawBody, secret)) {
      out.push(domain);
    }
  }
  return out;
}

/**
 * Among authorized domains, keep those matching payload repo URL + branch
 * (if the payload carries that information).
 */
export function filterDomainsForPayload(
  authorized: ResolvedDomain[],
  body: unknown,
): ResolvedDomain[] {
  const urls = extractRepoUrlsFromWebhookPayload(body);
  const branch = branchFromRef(
    body && typeof body === "object"
      ? (body as Record<string, unknown>).ref
      : null,
  );

  if (urls.length === 0) {
    // Token-only auth (e.g. GitLab) with empty body detail — sync all authorized
    return authorized;
  }

  return authorized.filter((d) => {
    if (!d.git.url) return false;
    if (!urls.some((u) => gitUrlsMatch(u, d.git.url!))) return false;
    if (branch && d.git.branch && branch !== d.git.branch) return false;
    return true;
  });
}

function isIgnorableEvent(request: Request, body: unknown): boolean {
  const gh = request.headers.get("x-github-event");
  if (gh && gh !== "push" && gh !== "ping") return true;
  if (gh === "ping") return true;

  const gl = request.headers.get("x-gitlab-event");
  if (gl && !/push/i.test(gl)) return true;

  const gitea = request.headers.get("x-gitea-event");
  if (gitea && gitea !== "push") return true;

  const forgejo = request.headers.get("x-forgejo-event");
  if (forgejo && forgejo !== "push") return true;

  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (o.object_kind && o.object_kind !== "push") return true;
  }
  return false;
}

export function verifyWebhookSecret(
  request: Request,
  rawBody: string,
  secret: string,
): boolean {
  const glToken = request.headers.get("x-gitlab-token");
  if (glToken !== null) {
    return secretsEqual(glToken, secret);
  }

  const ghSig = request.headers.get("x-hub-signature-256");
  if (ghSig) {
    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(rawBody).digest("hex");
    return secretsEqual(ghSig, expected);
  }

  const giteaSig =
    request.headers.get("x-gitea-signature") ??
    request.headers.get("x-forgejo-signature");
  if (giteaSig) {
    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    return secretsEqual(giteaSig, expected);
  }

  const shared =
    request.headers.get("x-lumina-webhook-secret") ??
    request.headers.get("x-webhook-secret");
  if (shared !== null) {
    return secretsEqual(shared, secret);
  }

  return false;
}

function secretsEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function json(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}
