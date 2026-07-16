import { describe, expect, test } from "bun:test";
import {
  branchFromRef,
  extractRepoUrlsFromWebhookPayload,
  gitUrlsMatch,
  normalizeGitUrl,
} from "../../src/git/url-match";

describe("normalizeGitUrl / gitUrlsMatch", () => {
  test("matches https and ssh forms", () => {
    expect(
      gitUrlsMatch(
        "https://github.com/org/repo.git",
        "git@github.com:org/repo.git",
      ),
    ).toBe(true);
    expect(normalizeGitUrl("https://GitHub.com/Org/Repo.git")).toBe(
      "github.com/org/repo",
    );
  });
});

describe("extractRepoUrlsFromWebhookPayload", () => {
  test("github shape", () => {
    const urls = extractRepoUrlsFromWebhookPayload({
      ref: "refs/heads/main",
      repository: {
        clone_url: "https://github.com/acme/site.git",
        ssh_url: "git@github.com:acme/site.git",
      },
    });
    expect(urls.some((u) => u.includes("acme/site"))).toBe(true);
  });

  test("gitlab shape", () => {
    const urls = extractRepoUrlsFromWebhookPayload({
      ref: "refs/heads/main",
      project: {
        git_http_url: "https://gitlab.com/acme/site.git",
      },
    });
    expect(urls[0]).toContain("gitlab.com/acme/site");
  });
});

describe("branchFromRef", () => {
  test("strips refs/heads", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main");
    expect(branchFromRef("refs/tags/v1")).toBeNull();
  });
});
