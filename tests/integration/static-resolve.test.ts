import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStaticFile } from "../../src/routing/static";

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
