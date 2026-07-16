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
      gitCacheDir: join(repoRoot, ".data/git-cache-endpoints-test"),
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

function request(path: string, init?: RequestInit) {
  const host = "example.com";
  const headers = new Headers(init?.headers);
  headers.set("host", host);
  return lumina.app.fetch(
    new Request(`http://${host}${path}`, { ...init, headers }),
  );
}

describe("example endpoint files", () => {
  test("GET /health — simple JSON", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /api — sample service payload", async () => {
    const res = await request("/api");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      route: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("lumina");
    expect(body.route).toBe("/api");
  });

  test("GET /hello/:name — dynamic segment", async () => {
    const res = await request("/hello/lumina");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "lumina" });
  });

  test("GET /users/:id/profile — nested dynamic", async () => {
    const res = await request("/users/42/profile");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "42", profile: true });
  });

  test("GET /docs/* — catch-all slug", async () => {
    const res = await request("/docs/guide/install");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      section: "docs",
      slug: "guide/install",
      parts: ["guide", "install"],
    });
  });

  test("GET /time — folder index as plain text", async () => {
    const res = await request("/time");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = (await res.text()).trim();
    expect(text).toMatch(
      /^Actual server time \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    );
  });

  test("GET /echo — method and query", async () => {
    const res = await request("/echo?x=1&y=two");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      method: string;
      path: string;
      query: Record<string, string>;
      body: unknown;
    };
    expect(body.method).toBe("GET");
    expect(body.path).toBe("/echo");
    expect(body.query).toEqual({ x: "1", y: "two" });
    expect(body.body).toBeNull();
  });

  test("POST /echo — JSON body", async () => {
    const res = await request("/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      method: string;
      body: { hello: string };
    };
    expect(body.method).toBe("POST");
    expect(body.body).toEqual({ hello: "world" });
  });

  test("GET /methods — method branching", async () => {
    const res = await request("/methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "GET", message: "read" });
  });

  test("POST /methods — 201 with body", async () => {
    const res = await request("/methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      method: "POST",
      received: { a: 1 },
    });
  });

  test("DELETE /methods — 204 empty", async () => {
    const res = await request("/methods", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("PUT /methods — 405", async () => {
    const res = await request("/methods", { method: "PUT" });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Method not allowed");
    expect(res.headers.get("Allow")).toContain("GET");
  });

  test("route source files are not downloadable as static", async () => {
    const res = await request("/routes/health.ts");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("status");
    expect(text).not.toContain("export default");
  });

  test("unknown route path returns 404", async () => {
    const res = await request("/no-such-endpoint");
    expect(res.status).toBe(404);
  });
});
