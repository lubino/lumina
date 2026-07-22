import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { STATIC_CACHE_CONTROL } from "../../src/caching/http-cache";
import { resolveStaticFile, serveStaticFile } from "../../src/routing/static";

const domainRoot = join(import.meta.dir, "../../examples/domains/example.com");

describe("resolveStaticFile", () => {
  test("finds index.html for /", () => {
    const r = resolveStaticFile(domainRoot, "/");
    expect(r.kind).toBe("file");
    if (r.kind === "file") {
      expect(r.path.endsWith("index.html")).toBe(true);
      expect(r.contentType).toContain("text/html");
    }
  });

  test("denies agents.md", () => {
    expect(resolveStaticFile(domainRoot, "/agents.md").kind).toBe("denied");
  });

  test("denies .env", () => {
    expect(resolveStaticFile(domainRoot, "/.env").kind).toBe("denied");
  });

  test("denies routes source files", () => {
    expect(resolveStaticFile(domainRoot, "/routes/api.ts").kind).toBe(
      "denied",
    );
  });

  test("finds css asset", () => {
    const r = resolveStaticFile(domainRoot, "/assets/style.css");
    expect(r.kind).toBe("file");
  });

  test("serveStaticFile sets revalidate cache headers and validators", async () => {
    const html = await serveStaticFile(domainRoot, "/");
    expect(html).not.toBeNull();
    expect(html!.status).toBe(200);
    expect(html!.headers.get("Cache-Control")).toBe(STATIC_CACHE_CONTROL);
    expect(html!.headers.get("Content-Type")).toContain("text/html");
    expect(html!.headers.get("ETag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(html!.headers.get("Last-Modified")).toBeTruthy();

    const css = await serveStaticFile(domainRoot, "/assets/style.css");
    expect(css).not.toBeNull();
    expect(css!.status).toBe(200);
    expect(css!.headers.get("Cache-Control")).toBe(STATIC_CACHE_CONTROL);
    expect(css!.headers.get("Content-Type")).toContain("text/css");
    expect(css!.headers.get("ETag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
  });

  test("serveStaticFile returns 304 when If-None-Match matches", async () => {
    const first = await serveStaticFile(domainRoot, "/assets/style.css");
    expect(first!.status).toBe(200);
    const etag = first!.headers.get("ETag")!;
    const body = await first!.text();
    expect(body.length).toBeGreaterThan(0);

    const cond = new Request("http://example.com/assets/style.css", {
      headers: { "If-None-Match": etag },
    });
    const second = await serveStaticFile(
      domainRoot,
      "/assets/style.css",
      cond,
    );
    expect(second!.status).toBe(304);
    expect(second!.headers.get("ETag")).toBe(etag);
    expect(second!.headers.get("Cache-Control")).toBe(STATIC_CACHE_CONTROL);
    expect(await second!.text()).toBe("");
  });

  test("serveStaticFile returns 200 with new ETag after file changes", async () => {
    const root = join(tmpdir(), `lumina-static-etag-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, "asset.txt");
    writeFileSync(filePath, "v1\n");
    // Stable mtime so first response is deterministic
    utimesSync(filePath, 1_600_000_000, 1_600_000_000);

    try {
      const first = await serveStaticFile(root, "/asset.txt");
      expect(first!.status).toBe(200);
      const etag1 = first!.headers.get("ETag")!;
      expect(await first!.text()).toBe("v1\n");

      writeFileSync(filePath, "v2-longer\n");
      utimesSync(filePath, 1_700_000_000, 1_700_000_000);
      expect(statSync(filePath).size).not.toBe(3); // content grew

      const cond = new Request("http://x/asset.txt", {
        headers: { "If-None-Match": etag1 },
      });
      const second = await serveStaticFile(root, "/asset.txt", cond);
      expect(second!.status).toBe(200);
      const etag2 = second!.headers.get("ETag")!;
      expect(etag2).not.toBe(etag1);
      expect(await second!.text()).toBe("v2-longer\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serves index from domain root under a git-cache parent path", () => {
    // Git-backed domains live at …/git-cache/<domain>/; absolute paths contain
    // the segment "git-cache", which must NOT block serving site files.
    const root = join(
      tmpdir(),
      `lumina-git-cache-static-${Date.now()}`,
      "git-cache",
      "cc10.cz",
    );
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "index.html"), "<h1>from git</h1>\n");

    try {
      const r = resolveStaticFile(root, "/");
      expect(r.kind).toBe("file");
      if (r.kind === "file") {
        expect(r.path.endsWith("index.html")).toBe(true);
      }
      // Still deny .git inside the working tree
      mkdirSync(join(root, ".git"), { recursive: true });
      writeFileSync(join(root, ".git", "config"), "secret");
      expect(resolveStaticFile(root, "/.git/config").kind).toBe("denied");
    } finally {
      rmSync(join(root, "..", ".."), { recursive: true, force: true });
    }
  });
});
