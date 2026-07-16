import { describe, expect, test } from "bun:test";
import { ConfigSchema } from "../../src/config/schema";
import { resolveConfig, type RuntimePaths } from "../../src/config/load";
import { resolveDomain } from "../../src/routing/domain-resolver";

const paths: RuntimePaths = {
  configPath: "/tmp/config.yaml",
  domainsDir: "/data/domains",
  gitCacheDir: "/data/git-cache",
};

function makeConfig() {
  const raw = ConfigSchema.parse({
    domains: {
      "example.com": {
        root: "example.com",
        aliases: ["www.example.com", "localhost"],
      },
      "other.local": {
        root: "other.local",
      },
    },
  });
  return resolveConfig(raw, paths);
}

describe("resolveDomain", () => {
  test("matches primary host and aliases", () => {
    const config = makeConfig();
    expect(resolveDomain(config, "example.com")?.name).toBe("example.com");
    expect(resolveDomain(config, "www.example.com")?.name).toBe("example.com");
    expect(resolveDomain(config, "localhost:3000")?.name).toBe("example.com");
  });

  test("matches second domain", () => {
    const config = makeConfig();
    expect(resolveDomain(config, "other.local")?.name).toBe("other.local");
  });

  test("returns null for unknown host", () => {
    const config = makeConfig();
    expect(resolveDomain(config, "unknown.test")).toBeNull();
  });

  test("strips port from Host header", () => {
    const config = makeConfig();
    expect(resolveDomain(config, "EXAMPLE.COM:8080")?.name).toBe("example.com");
  });
});

describe("resolveConfig roots", () => {
  test("resolves relative roots under domains_dir", () => {
    const config = makeConfig();
    const d = config.domains.get("example.com");
    expect(d?.root).toBe("/data/domains/example.com");
  });

  test("resolves git cache roots when enabled", () => {
    const raw = ConfigSchema.parse({
      domains: {
        "docs.example.com": {
          git: {
            enabled: true,
            url: "https://example.com/repo.git",
            branch: "main",
            path: "public",
          },
        },
      },
    });
    const config = resolveConfig(raw, paths);
    expect(config.domains.get("docs.example.com")?.root).toBe(
      "/data/git-cache/docs.example.com/public",
    );
  });
});
