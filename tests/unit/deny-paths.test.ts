import { describe, expect, test } from "bun:test";
import {
  isDeniedFsPath,
  isDeniedUrlPath,
} from "../../src/security/deny-paths";

describe("isDeniedUrlPath", () => {
  test("allows normal public paths", () => {
    expect(isDeniedUrlPath("/").denied).toBe(false);
    expect(isDeniedUrlPath("/index.html").denied).toBe(false);
    expect(isDeniedUrlPath("/assets/style.css").denied).toBe(false);
    expect(isDeniedUrlPath("/.well-known/acme-challenge/token").denied).toBe(
      false,
    );
  });

  test("blocks agent and tooling files", () => {
    expect(isDeniedUrlPath("/agents.md").denied).toBe(true);
    expect(isDeniedUrlPath("/AGENTS.md").denied).toBe(true);
    expect(isDeniedUrlPath("/CLAUDE.md").denied).toBe(true);
    expect(isDeniedUrlPath("/.cursorrules").denied).toBe(true);
  });

  test("blocks .git and nested VCS", () => {
    expect(isDeniedUrlPath("/.git/config").denied).toBe(true);
    expect(isDeniedUrlPath("/foo/.git/HEAD").denied).toBe(true);
  });

  test("blocks node_modules and package manifests", () => {
    expect(isDeniedUrlPath("/node_modules/hono/package.json").denied).toBe(
      true,
    );
    expect(isDeniedUrlPath("/package.json").denied).toBe(true);
    expect(isDeniedUrlPath("/bun.lockb").denied).toBe(true);
  });

  test("blocks secrets and keys", () => {
    expect(isDeniedUrlPath("/.env").denied).toBe(true);
    expect(isDeniedUrlPath("/.env.local").denied).toBe(true);
    expect(isDeniedUrlPath("/id_rsa").denied).toBe(true);
    expect(isDeniedUrlPath("/cert.pem").denied).toBe(true);
  });

  test("blocks hidden segments except .well-known", () => {
    expect(isDeniedUrlPath("/.hidden/file").denied).toBe(true);
    expect(isDeniedUrlPath("/.well-known/security.txt").denied).toBe(false);
  });
});

describe("isDeniedFsPath", () => {
  test("blocks relative paths under domain root", () => {
    expect(isDeniedFsPath("agents.md").denied).toBe(true);
    expect(isDeniedFsPath(".git/config").denied).toBe(true);
    expect(isDeniedFsPath("node_modules/x").denied).toBe(true);
    expect(isDeniedFsPath("assets/ok.png").denied).toBe(false);
  });
});
