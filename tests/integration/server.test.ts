import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { startLuminaServer, type LuminaServer } from "../../src/server/lifecycle";

const repoRoot = join(import.meta.dir, "../..");

let lumina: LuminaServer;

beforeAll(async () => {
  lumina = await startLuminaServer({
    paths: {
      configPath: join(repoRoot, "examples/config.yaml"),
      domainsDir: join(repoRoot, "examples/domains"),
      gitCacheDir: join(repoRoot, ".data/git-cache-test"),
    },
    watch: false,
    syncGit: false,
    port: 0,
    hostname: "127.0.0.1",
  });
});

afterAll(() => {
  lumina?.stop();
});

/** Call the app directly so Host is under our control (fetch() may rewrite Host). */
function request(path: string, host: string, init?: RequestInit) {
  const url = `http://${host}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("host", host);
  return lumina.app.fetch(new Request(url, { ...init, headers }));
}

describe("Lumina integration", () => {
  test("serves static index for example.com", async () => {
    const res = await request("/", "example.com");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("example.com");
    expect(res.headers.get("X-Lumina-Domain")).toBe("example.com");
    // Revalidate always so CDNs/browsers do not keep stale bodies after git pull
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    // Small HTML uses content-hash ETag
    expect(res.headers.get("ETag")).toMatch(/^"h[0-9a-f]{16}"$/);
    expect(res.headers.get("Last-Modified")).toBeTruthy();
  });

  test("serves alias www.example.com from same root", async () => {
    const res = await request("/", "www.example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Lumina-Domain")).toBe("example.com");
  });

  test("serves second domain other.local", async () => {
    const res = await request("/", "other.local");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("other.local");
    expect(res.headers.get("X-Lumina-Domain")).toBe("other.local");
  });

  test("serves static CSS", async () => {
    const res = await request("/assets/style.css", "example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/css");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    const css = await res.text();
    expect(css).toContain("color-scheme");
  });

  test("static conditional GET returns 304 when ETag matches", async () => {
    const first = await request("/assets/style.css", "example.com");
    expect(first.status).toBe(200);
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    await first.text();

    const second = await request("/assets/style.css", "example.com", {
      headers: { "If-None-Match": etag! },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("X-Lumina-Domain")).toBe("example.com");
    expect(await second.text()).toBe("");
  });

  test("reloadDomainRoutes bumps static meta so ETag is re-read from disk", async () => {
    const domain = lumina.app.getConfig().domains.get("example.com")!;
    const first = await request("/assets/style.css", "example.com");
    expect(first.status).toBe(200);
    const etag1 = first.headers.get("ETag")!;
    await first.text();

    const cssPath = `${domain.root}/assets/style.css`;
    expect(lumina.app.staticMeta.getMeta(cssPath, domain.root)).not.toBeNull();

    const genBefore = lumina.app.staticMeta.generation(domain.root);
    await lumina.app.reloadDomainRoutes("example.com");
    const genAfter = lumina.app.staticMeta.generation(domain.root);
    expect(genAfter).toBe(genBefore + 1);
    // Meta for this root is dropped (other domains may still hold entries)
    expect(lumina.app.staticMeta.getMeta(cssPath, domain.root)).toBeNull();

    const second = await request("/assets/style.css", "example.com");
    expect(second.status).toBe(200);
    // Same file on disk → same ETag after re-stat
    expect(second.headers.get("ETag")).toBe(etag1);
    await second.text();
  });

  test("dynamic /api route", async () => {
    const res = await request("/api", "example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; route: string };
    expect(body.ok).toBe(true);
    expect(body.route).toBe("/api");
    // Handlers that omit Cache-Control get a safe default (not public static)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("dynamic /hello/:name route", async () => {
    const res = await request("/hello/lumina", "example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string };
    expect(body.hello).toBe("lumina");
  });

  test("never serves agents.md", async () => {
    const res = await request("/agents.md", "example.com");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("secret-agent-instructions");
  });

  test("never serves .env", async () => {
    const res = await request("/.env", "example.com");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("SECRET=");
  });

  test("never serves package.json style paths", async () => {
    const res = await request("/package.json", "example.com");
    expect(res.status).toBe(404);
  });

  test("unknown host returns HTML 404 page", async () => {
    const res = await request("/", "unknown.example");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Unknown host");
    expect(html).toContain("unknown.example");
  });

  test("missing static path returns 404", async () => {
    const res = await request("/no-such-page.html", "example.com");
    expect(res.status).toBe(404);
  });

  test("blocks path traversal", async () => {
    const res = await request("/../../etc/passwd", "example.com");
    expect(res.status).toBe(404);
  });

  test("api.example.com shares example.com root", async () => {
    const res = await request("/api", "api.example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(res.headers.get("X-Lumina-Domain")).toBe("api.example.com");
  });

  test("HTTP listener responds on bound port", async () => {
    // localhost is aliased to example.com in examples/config.yaml
    const res = await fetch(
      `http://127.0.0.1:${lumina.server.port}/assets/style.css`,
      { headers: { Host: "localhost" } },
    );
    // If Host is overridden by the client, fall back to checking server is up
    // via any response from the process.
    expect([200, 404]).toContain(res.status);
  });
});
