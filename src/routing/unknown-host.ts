import type { ResolvedConfig } from "../config/types";
import type { RequestHostInfo } from "./request-host";
import { listHosts } from "./domain-resolver";

export interface UnknownHostPageInput {
  config: ResolvedConfig;
  request: Request;
  hostInfo: RequestHostInfo;
}

/**
 * HTML 404 for unmatched Host — operator-facing diagnostics + suggested YAML.
 */
export function renderUnknownHostPage(input: UnknownHostPageInput): Response {
  const { config, request, hostInfo } = input;
  const url = safeUrl(request.url);
  const pathname = url?.pathname ?? "/";
  const method = request.method;
  const known = listHosts(config);
  const requested = hostInfo.host;
  const rawHost = hostInfo.raw;

  const suggestedRoot = suggestedFolderName(requested);
  const yamlSnippet = buildSuggestedYaml(requested, suggestedRoot);
  const domainsDir = config.domainsDir;

  const whatsWrong = buildWhatsWrong(requested, known, hostInfo);
  const howTo = buildHowTo(requested, suggestedRoot, domainsDir);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 — Unknown host · Lumina</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1220;
      --card: #111827;
      --border: #1f2937;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #38bdf8;
      --warn: #fbbf24;
      --code: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #1e3a5f 0%, transparent 50%), var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      max-width: 52rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 4rem;
    }
    h1 { font-size: 1.75rem; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
    h2 { font-size: 1.05rem; margin: 1.75rem 0 0.6rem; color: var(--accent); }
    p, li { color: var(--muted); }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #0f172a;
      background: var(--warn);
      padding: 0.2rem 0.5rem;
      border-radius: 0.35rem;
      margin-bottom: 0.75rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.85rem;
      padding: 1.1rem 1.25rem;
      margin-top: 1rem;
    }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
    }
    code {
      background: var(--code);
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
      color: #e2e8f0;
    }
    pre {
      background: var(--code);
      border: 1px solid var(--border);
      border-radius: 0.6rem;
      padding: 0.9rem 1rem;
      overflow-x: auto;
      color: #e2e8f0;
      margin: 0.5rem 0 0;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td {
      text-align: left;
      padding: 0.45rem 0.35rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 500; width: 11rem; }
    td { color: var(--text); word-break: break-all; }
    ul { padding-left: 1.2rem; margin: 0.4rem 0; }
    .ok { color: #86efac; }
    footer {
      margin-top: 2rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <div class="badge">404 · Unknown host</div>
    <h1>Lumina does not know this hostname</h1>
    <p>
      <strong>Lumina</strong> is a multi-domain web server. It picks a site from the
      request hostname (virtual host), not only from the URL path.
      The hostname on this request is not listed as a domain or alias in your config.
      Lumina also supports <strong>cloudflared</strong> tunnels.
    </p>

    <div class="card">
      <h2 style="margin-top:0">What this request looked like</h2>
      <table>
        <tr><th>Requested host</th><td><code>${escapeHtml(requested ?? "(missing)")}</code></td></tr>
        <tr><th>Raw host value</th><td><code>${escapeHtml(rawHost ?? "—")}</code></td></tr>
        <tr><th>Host taken from</th><td><code>${escapeHtml(hostInfo.source)}</code></td></tr>
        <tr><th>Method / path</th><td><code>${escapeHtml(method)} ${escapeHtml(pathname)}</code></td></tr>
        <tr><th>Request URL</th><td><code>${escapeHtml(request.url)}</code></td></tr>
      </table>
    </div>

    <div class="card">
      <h2 style="margin-top:0">What is wrong</h2>
      <ul>
        ${whatsWrong.map((line) => `<li>${line}</li>`).join("\n        ")}
      </ul>
      <p style="margin-bottom:0">
        Currently configured hostnames (${known.length}):
        ${
          known.length
            ? known.map((h) => `<code>${escapeHtml(h)}</code>`).join(" ")
            : "<em>none — your <code>domains:</code> map is empty</em>"
        }
      </p>
    </div>

    <div class="card">
      <h2 style="margin-top:0">How to fix it</h2>
      <ol>
        ${howTo.map((line) => `<li>${line}</li>`).join("\n        ")}
      </ol>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Suggested config for this request</h2>
      <p>Add the following under <code>domains:</code> in your Lumina YAML (paths assume container defaults; adjust if needed):</p>
      <pre>${escapeHtml(yamlSnippet)}</pre>
      <p style="margin-bottom:0">
        Content directory to create:
        <code>${escapeHtml(domainsDir)}/${escapeHtml(suggestedRoot || "your-site")}</code>
        (at least an <code>index.html</code>).
      </p>
    </div>

    <footer>
      Lumina · multi-domain server · host routing ·
      config file: <code>${escapeHtml(config.configPath)}</code>
    </footer>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Lumina-Error": "unknown-host",
      "Cache-Control": "no-store",
    },
  });
}

function buildWhatsWrong(
  requested: string | null,
  known: string[],
  hostInfo: RequestHostInfo,
): string[] {
  const lines: string[] = [];
  if (!requested) {
    lines.push(
      "No usable hostname was found on the request (missing <code>Host</code> / forwarded host headers).",
    );
  } else {
    lines.push(
      `Hostname <code>${escapeHtml(requested)}</code> is not registered as a <strong>domain key</strong> or <strong>alias</strong> in the active config.`,
    );
  }
  if (known.length === 0) {
    lines.push("The configuration has an empty <code>domains:</code> section.");
  } else {
    lines.push(
      "Lumina only serves hosts that are explicitly listed — there is no automatic “default site” for unknown names (except a single-domain fallback when the Host header is completely missing).",
    );
  }
  if (hostInfo.source === "host" && hostInfo.candidates.some((c) => c.source === "x-forwarded-host")) {
    lines.push(
      "Note: both <code>Host</code> and <code>X-Forwarded-Host</code> were present; Lumina preferred the forwarded public hostname.",
    );
  }
  if (
    requested &&
    (requested === "localhost" ||
      requested === "127.0.0.1" ||
      requested.endsWith(".localhost"))
  ) {
    lines.push(
      "You are using a local loopback name. Either add it as an alias of an existing domain, or open the site via a configured hostname / <code>Host</code> header.",
    );
  }
  return lines;
}

function buildHowTo(
  requested: string | null,
  suggestedRoot: string,
  domainsDir: string,
): string[] {
  const host = requested ?? "your.domain.example";
  return [
    `Edit the YAML pointed to by <code>LUMINA_CONFIG</code> (or the path shown in the footer).`,
    `Add a <code>domains:</code> entry for <code>${escapeHtml(host)}</code> (or add it under <code>aliases:</code> of an existing domain if it should share content).`,
    `Create a content folder <code>${escapeHtml(domainsDir)}/${escapeHtml(suggestedRoot || "your-site")}</code> with static files and optional <code>routes/</code> endpoints.`,
    `Save the file — with watching enabled, Lumina reloads domains without restarting the container.`,
  ];
}

function buildSuggestedYaml(host: string | null, root: string): string {
  const name = host && host.length > 0 ? host : "your.domain.example";
  const folder = root || "your-domain";
  const isLocal =
    name === "localhost" ||
    name === "127.0.0.1" ||
    name.endsWith(".localhost");

  const aliasBlock = isLocal
    ? ""
    : `    aliases:\n      - www.${name}\n`;

  return `# Generated from an unmatched request to: ${name}
# Paste under the top-level "domains:" key in config.yaml

  ${name}:
    root: ${folder}              # → \${LUMINA_DOMAINS_DIR}/${folder}
${aliasBlock}    git:
      enabled: false
`;
}

function suggestedFolderName(host: string | null): string {
  if (!host) return "default-site";
  // Keep DNS-like folder names; sanitize path-hostile chars
  return host.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
