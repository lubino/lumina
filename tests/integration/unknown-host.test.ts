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
      gitCacheDir: join(repoRoot, ".data/git-cache-unknown-host"),
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

function requestAsHost(path: string, host: string) {
  return lumina.app.fetch(
    new Request(`http://${host}${path}`, {
      headers: { host },
    }),
  );
}

describe("unknown host HTML page", () => {
  test("request to a host outside configured domains returns HTML 404 page", async () => {
    // examples/config.yaml registers: example.com, www.example.com, localhost,
    // api.example.com, other.local, other.localhost — not this name.
    const unconfiguredHost = "not-in-config.example";

    const res = await requestAsHost("/", unconfiguredHost);

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Lumina-Error")).toBe("unknown-host");
    // Must not look like a successful site response
    expect(res.headers.get("X-Lumina-Domain")).toBeNull();

    const html = await res.text();
    expect(html).toContain("Lumina does not know this hostname");
    expect(html).toContain(unconfiguredHost);
    expect(html).toContain("What is wrong");
    // Must not disclose other configured hostnames
    expect(html).not.toContain("Currently configured hostnames");
    expect(html).not.toContain("other.local");
    // How to fix: LUMINA_CONFIG with actual path; not only in footer
    expect(html).toContain("LUMINA_CONFIG");
    expect(html).toContain("examples/config.yaml");
    expect(html).not.toContain("config file:");
    // Pre-generated YAML for this request only
    expect(html).toContain("Suggested config for this request");
    expect(html).toContain(`${unconfiguredHost}:`);
    // Must not serve example.com site content
    expect(html).not.toContain("Served by <strong>Lumina</strong> multi-domain server");
  });

  test("returns HTML 404 with diagnostics and suggested config", async () => {
    const res = await lumina.app.fetch(
      new Request("http://missing.example.test/", {
        headers: { host: "missing.example.test" },
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Lumina-Error")).toBe("unknown-host");

    const html = await res.text();
    expect(html).toContain("Lumina does not know this hostname");
    expect(html).toContain("missing.example.test");
    expect(html).toContain("Suggested config for this request");
    expect(html).toContain("missing.example.test:");
    expect(html).toContain("root: missing.example.test");
    expect(html).toContain("cloudflared");
    expect(html).toContain("nginx");
    expect(html).toContain("HAProxy");
    expect(html).not.toContain("Cloudflare Tunnel (cloudflared)");
    expect(html).not.toContain("Currently configured hostnames");
  });

  test("uses X-Forwarded-Host for matching (cloudflared style)", async () => {
    const res = await lumina.app.fetch(
      new Request("http://lumina-internal:3000/", {
        headers: {
          host: "lumina-internal:3000",
          "x-forwarded-host": "example.com",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Lumina-Domain")).toBe("example.com");
    expect(res.headers.get("X-Lumina-Host")).toBe("example.com");
    const html = await res.text();
    expect(html).toContain("example.com");
  });

  test("unknown X-Forwarded-Host shows that public name on the 404 page", async () => {
    const res = await lumina.app.fetch(
      new Request("http://lumina-internal:3000/path", {
        headers: {
          host: "lumina-internal:3000",
          "x-forwarded-host": "tunnel-only.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("tunnel-only.example");
    expect(html).toContain("x-forwarded-host");
    expect(html).toContain("tunnel-only.example:");
    expect(html).toContain("Suggested config for this request");
  });

  test("matches other.local via Forwarded header", async () => {
    const res = await lumina.app.fetch(
      new Request("http://127.0.0.1/", {
        headers: {
          host: "127.0.0.1:3030",
          forwarded: "for=1.1.1.1;host=other.local;proto=https",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Lumina-Domain")).toBe("other.local");
    const html = await res.text();
    expect(html).toContain("other.local");
  });
});
