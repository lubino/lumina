import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  fileToRoutePattern,
  matchPattern,
} from "../../src/routing/dynamic";

describe("fileToRoutePattern", () => {
  const root = "/sites/example.com/routes";

  test("maps simple files", () => {
    expect(fileToRoutePattern(root, join(root, "api.ts"))).toBe("/api");
    expect(fileToRoutePattern(root, join(root, "health.ts"))).toBe("/health");
  });

  test("maps index to folder path or /", () => {
    expect(fileToRoutePattern(root, join(root, "index.ts"))).toBe("/");
    expect(fileToRoutePattern(root, join(root, "time", "index.ts"))).toBe(
      "/time",
    );
  });

  test("maps dynamic segments", () => {
    expect(fileToRoutePattern(root, join(root, "hello", "[name].ts"))).toBe(
      "/hello/:name",
    );
  });

  test("maps nested dynamic segments", () => {
    expect(
      fileToRoutePattern(
        root,
        join(root, "users", "[id]", "profile.ts"),
      ),
    ).toBe("/users/:id/profile");
  });

  test("maps catch-all segments", () => {
    expect(
      fileToRoutePattern(root, join(root, "docs", "[...slug].ts")),
    ).toBe("/docs/*:slug");
  });

  test("maps optional catch-all segments", () => {
    expect(
      fileToRoutePattern(root, join(root, "blog", "[[...slug]].ts")),
    ).toBe("/blog/*:slug");
  });
});

describe("matchPattern", () => {
  test("matches static paths", () => {
    expect(matchPattern("/api", "/api")).toEqual({});
    expect(matchPattern("/api", "/api/")).toEqual({});
    expect(matchPattern("/health", "/other")).toBeNull();
  });

  test("matches single dynamic segment", () => {
    expect(matchPattern("/hello/:name", "/hello/world")).toEqual({
      name: "world",
    });
    expect(matchPattern("/hello/:name", "/hello")).toBeNull();
    expect(matchPattern("/hello/:name", "/hello/a/b")).toBeNull();
  });

  test("matches nested dynamic path", () => {
    expect(matchPattern("/users/:id/profile", "/users/42/profile")).toEqual({
      id: "42",
    });
    expect(matchPattern("/users/:id/profile", "/users/42")).toBeNull();
  });

  test("matches catch-all", () => {
    expect(matchPattern("/docs/*:slug", "/docs/a")).toEqual({ slug: "a" });
    expect(matchPattern("/docs/*:slug", "/docs/a/b/c")).toEqual({
      slug: "a/b/c",
    });
    expect(matchPattern("/docs/*:slug", "/docs")).toEqual({ slug: "" });
  });

  test("decodes URI components in params", () => {
    expect(matchPattern("/hello/:name", "/hello/hello%20world")).toEqual({
      name: "hello world",
    });
  });

  test("root pattern", () => {
    expect(matchPattern("/", "/")).toEqual({});
    expect(matchPattern("/", "/x")).toBeNull();
  });
});
