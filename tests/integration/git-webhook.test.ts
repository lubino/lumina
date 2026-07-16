import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { startLuminaServer, type LuminaServer } from "../../src/server/lifecycle";
import { GIT_WEBHOOK_PATH } from "../../src/git/webhook";

const repoRoot = join(import.meta.dir, "../..");
const tmp = join(tmpdir(), `lumina-webhook-test-${Date.now()}`);
const configPath = join(tmp, "config.yaml");

mkdirSync(tmp, { recursive: true });
writeFileSync(
  configPath,
  `
domains:
  docs.local:
    root: docs.local
    git:
      enabled: true
      url: "https://github.com/acme/docs.git"
      branch: "main"
      poll_seconds: 0
      webhook_secret: "secret-docs-only"
  other.local:
    root: other.local
    git:
      enabled: true
      url: "https://github.com/acme/other.git"
      branch: "main"
      webhook_secret: "secret-other-only"
`,
  "utf8",
);

// minimal domain dirs so config resolves
mkdirSync(join(tmp, "docs.local"), { recursive: true });
mkdirSync(join(tmp, "other.local"), { recursive: true });

let lumina: LuminaServer;

beforeAll(async () => {
  lumina = await startLuminaServer({
    paths: {
      configPath,
      domainsDir: tmp,
      gitCacheDir: join(tmp, "git-cache"),
    },
    watch: false,
    syncGit: false,
    gitPoll: false,
    port: 0,
    hostname: "127.0.0.1",
    gitWebhookCooldownMs: 60_000,
  });
});

afterAll(() => {
  lumina?.stop();
});

function githubPush(secret: string, cloneUrl: string) {
  const body = JSON.stringify({
    ref: "refs/heads/main",
    repository: { clone_url: cloneUrl },
  });
  const sig =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return lumina.app.fetch(
    new Request(`http://127.0.0.1${GIT_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": sig,
      },
      body,
    }),
  );
}

describe("POST /_lumina/hooks/git per-domain webhook_secret", () => {
  test("rejects when signature does not match any domain secret", async () => {
    const res = await githubPush(
      "wrong-secret",
      "https://github.com/acme/docs.git",
    );
    expect(res.status).toBe(401);
  });

  test("accepts when secret matches the docs domain entry", async () => {
    const res = await githubPush(
      "secret-docs-only",
      "https://github.com/acme/docs.git",
    );
    expect([200, 202]).toContain(res.status);
    const body = (await res.json()) as { ok: boolean; domains: string[] };
    expect(body.ok).toBe(true);
    expect(body.domains).toContain("docs.local");
    expect(body.domains).not.toContain("other.local");
  });

  test("secret for other domain does not authorize docs repo payload", async () => {
    const res = await githubPush(
      "secret-other-only",
      "https://github.com/acme/docs.git",
    );
    // Secret verifies other.local, but URL is docs → no matching domain
    expect(res.status).toBe(202);
    const body = (await res.json()) as { action: string };
    expect(body.action).toBe("ignored_no_matching_domain");
  });

  test("rejects GET", async () => {
    const res = await lumina.app.fetch(
      new Request(`http://127.0.0.1${GIT_WEBHOOK_PATH}`, { method: "GET" }),
    );
    expect(res.status).toBe(405);
  });

  test("ignores non-push github events", async () => {
    const res = await lumina.app.fetch(
      new Request(`http://127.0.0.1${GIT_WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
        },
        body: JSON.stringify({ zen: "design" }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { action: string };
    expect(body.action).toBe("ignored_event");
  });

  test("second hit within cooldown is scheduled/ignored", async () => {
    const a = await githubPush(
      "secret-docs-only",
      "https://github.com/acme/docs.git",
    );
    const bodyA = (await a.json()) as { action: string };
    const b = await githubPush(
      "secret-docs-only",
      "https://github.com/acme/docs.git",
    );
    const bodyB = (await b.json()) as { action: string };
    expect(["started", "scheduled", "ignored", "rescheduled"]).toContain(
      bodyA.action,
    );
    expect(["scheduled", "ignored", "rescheduled"]).toContain(bodyB.action);
  });
});
