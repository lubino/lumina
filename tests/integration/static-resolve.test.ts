import { describe, expect, test } from "bun:test";
import { join } from "node:path";
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
});
