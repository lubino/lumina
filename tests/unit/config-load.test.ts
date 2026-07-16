import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_HOST, DEFAULT_PORT } from "../../src/constants";
import {
  loadConfig,
  loadRawConfig,
  normalizeHost,
  resolveListenHost,
  resolveListenPort,
} from "../../src/config/load";
import { ConfigSchema } from "../../src/config/schema";

const repoRoot = join(import.meta.dir, "../..");

describe("loadConfig with examples", () => {
  test("loads examples/config.yaml", () => {
    const config = loadConfig({
      configPath: join(repoRoot, "examples/config.yaml"),
      domainsDir: join(repoRoot, "examples/domains"),
      gitCacheDir: join(repoRoot, ".data/git-cache"),
    });

    expect(config.domains.has("example.com")).toBe(true);
    expect(config.domains.has("other.local")).toBe(true);
    expect(config.hostIndex.get("www.example.com")).toBe("example.com");
    expect(config.hostIndex.get("localhost")).toBe("example.com");
    expect(config.listen.port).toBe(DEFAULT_PORT);
    expect(config.listen.host).toBe(DEFAULT_HOST);
    expect(DEFAULT_PORT).toBe(3030);
    expect(DEFAULT_HOST).toBe("0.0.0.0");
  });

  test("respects explicit RuntimePaths host/port", () => {
    const config = loadConfig({
      configPath: join(repoRoot, "examples/config.yaml"),
      domainsDir: join(repoRoot, "examples/domains"),
      gitCacheDir: join(repoRoot, ".data/git-cache"),
      port: 9999,
      host: "127.0.0.1",
    });
    expect(config.listen.port).toBe(9999);
    expect(config.listen.host).toBe("127.0.0.1");
  });
});

describe("resolveListenPort", () => {
  test("defaults to 3030 when unset or empty", () => {
    expect(resolveListenPort(undefined)).toBe(3030);
    expect(resolveListenPort("")).toBe(3030);
    expect(resolveListenPort("   ")).toBe(3030);
  });

  test("parses valid port", () => {
    expect(resolveListenPort("8080")).toBe(8080);
  });

  test("rejects invalid port", () => {
    expect(() => resolveListenPort("nope")).toThrow(/Invalid LUMINA_PORT/);
    expect(() => resolveListenPort("0")).toThrow(/Invalid LUMINA_PORT/);
  });
});

describe("resolveListenHost", () => {
  test("defaults to 0.0.0.0 when unset or empty", () => {
    expect(resolveListenHost(undefined)).toBe("0.0.0.0");
    expect(resolveListenHost("")).toBe("0.0.0.0");
  });

  test("trims custom host", () => {
    expect(resolveListenHost(" 127.0.0.1 ")).toBe("127.0.0.1");
  });
});

describe("YAML has no server section", () => {
  test("rejects top-level server key", () => {
    expect(() =>
      ConfigSchema.parse({
        server: { host: "0.0.0.0", port: 3000 },
        domains: {},
      }),
    ).toThrow();
  });

  test("examples/config.yaml has no server key", () => {
    const raw = loadRawConfig(join(repoRoot, "examples/config.yaml"));
    expect(raw).not.toHaveProperty("server");
  });
});

describe("normalizeHost", () => {
  test("lowercases and strips port", () => {
    expect(normalizeHost("Example.COM:3000")).toBe("example.com");
    expect(normalizeHost("localhost")).toBe("localhost");
  });
});
