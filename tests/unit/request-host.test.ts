import { describe, expect, test } from "bun:test";
import {
  parseForwardedHost,
  resolveRequestHost,
} from "../../src/routing/request-host";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("resolveRequestHost", () => {
  test("uses Host header when no proxy headers", () => {
    const info = resolveRequestHost(
      req("http://127.0.0.1:3030/", { host: "example.com:3030" }),
    );
    expect(info.host).toBe("example.com");
    expect(info.source).toBe("host");
  });

  test("prefers X-Forwarded-Host over Host (cloudflared / reverse proxy)", () => {
    const info = resolveRequestHost(
      req("http://lumina:3000/", {
        host: "lumina:3000",
        "x-forwarded-host": "shop.example.com",
      }),
    );
    expect(info.host).toBe("shop.example.com");
    expect(info.source).toBe("x-forwarded-host");
  });

  test("takes first host from comma-separated X-Forwarded-Host", () => {
    const info = resolveRequestHost(
      req("http://127.0.0.1/", {
        host: "internal",
        "x-forwarded-host": "public.example.com, other.internal",
      }),
    );
    expect(info.host).toBe("public.example.com");
  });

  test("parses Forwarded host= parameter", () => {
    const info = resolveRequestHost(
      req("http://127.0.0.1/", {
        host: "backend",
        forwarded: 'for=1.2.3.4;proto=https;host=app.example.com',
      }),
    );
    expect(info.host).toBe("app.example.com");
    expect(info.source).toBe("forwarded");
  });

  test("X-Forwarded-Host wins over Forwarded", () => {
    const info = resolveRequestHost(
      req("http://127.0.0.1/", {
        host: "backend",
        "x-forwarded-host": "a.example.com",
        forwarded: "host=b.example.com",
      }),
    );
    expect(info.host).toBe("a.example.com");
    expect(info.source).toBe("x-forwarded-host");
  });

  test("falls back to URL hostname", () => {
    const info = resolveRequestHost(req("http://only-in-url.example/path"));
    expect(info.host).toBe("only-in-url.example");
    expect(info.source).toBe("url");
  });

  test("strips port from forwarded host", () => {
    const info = resolveRequestHost(
      req("http://127.0.0.1/", {
        "x-forwarded-host": "tunnel.example.com:443",
      }),
    );
    expect(info.host).toBe("tunnel.example.com");
  });
});

describe("parseForwardedHost", () => {
  test("extracts quoted and bare host", () => {
    expect(parseForwardedHost('host="foo.bar"')).toBe("foo.bar");
    expect(parseForwardedHost("for=10.0.0.1;host=baz.test;proto=https")).toBe(
      "baz.test",
    );
  });
});
