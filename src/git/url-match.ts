/** Normalize a git remote URL for comparison (provider-agnostic). */
export function normalizeGitUrl(url: string): string {
  let u = url.trim().toLowerCase();
  // git@host:path → host/path
  const scp = u.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    u = `${scp[1]}/${scp[2]}`;
  }
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/^ssh:\/\//, "");
  u = u.replace(/^git:\/\//, "");
  u = u.replace(/\.git$/, "");
  u = u.replace(/\/+$/, "");
  // drop userinfo
  u = u.replace(/^[^@]+@/, "");
  return u;
}

export function gitUrlsMatch(a: string, b: string): boolean {
  return normalizeGitUrl(a) === normalizeGitUrl(b);
}

/**
 * Collect candidate clone/web URLs from a webhook JSON body
 * (GitHub, GitLab, Forgejo/Gitea shapes).
 */
export function extractRepoUrlsFromWebhookPayload(
  body: unknown,
): string[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  const urls: string[] = [];

  const repo = o.repository;
  if (repo && typeof repo === "object") {
    const r = repo as Record<string, unknown>;
    for (const key of [
      "clone_url",
      "git_http_url",
      "git_ssh_url",
      "ssh_url",
      "html_url",
      "url",
    ]) {
      const v = r[key];
      if (typeof v === "string" && v.length > 0) urls.push(v);
    }
  }

  // GitLab project
  const project = o.project;
  if (project && typeof project === "object") {
    const p = project as Record<string, unknown>;
    for (const key of [
      "git_http_url",
      "git_ssh_url",
      "http_url",
      "url",
      "web_url",
    ]) {
      const v = p[key];
      if (typeof v === "string" && v.length > 0) urls.push(v);
    }
  }

  return [...new Set(urls)];
}

/** Parse branch from refs/heads/main or bare name. */
export function branchFromRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref) return null;
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("refs/")) return null; // tags etc.
  return ref;
}
