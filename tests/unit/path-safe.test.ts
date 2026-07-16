import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveSafePath } from "../../src/security/path-safe";

const root = join("/tmp", "lumina-domain-root");

describe("resolveSafePath", () => {
  test("resolves nested files under root", () => {
    const p = resolveSafePath(root, "/assets/style.css");
    expect(p).toBe(join(root, "assets", "style.css"));
  });

  test("rejects parent traversal", () => {
    expect(resolveSafePath(root, "/../etc/passwd")).toBeNull();
    expect(resolveSafePath(root, "/assets/../../etc/passwd")).toBeNull();
  });

  test("rejects encoded traversal", () => {
    expect(resolveSafePath(root, "/%2e%2e/etc/passwd")).toBeNull();
  });

  test("rejects null bytes", () => {
    expect(resolveSafePath(root, "/foo%00.html")).toBeNull();
  });

  test("allows root index path", () => {
    const p = resolveSafePath(root, "/");
    expect(p).toBe(root);
  });
});
