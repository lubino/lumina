#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Prefer project-local / user Bun install
export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is not installed or not on PATH" >&2
  echo "Install from https://bun.sh then re-run this script." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  bun install
fi

export LUMINA_CONFIG="${LUMINA_CONFIG:-./examples/config.yaml}"
export LUMINA_DOMAINS_DIR="${LUMINA_DOMAINS_DIR:-./examples/domains}"
export LUMINA_GIT_CACHE_DIR="${LUMINA_GIT_CACHE_DIR:-./.data/git-cache}"
export LUMINA_PORT="${LUMINA_PORT:-3030}"
export LUMINA_HOST="${LUMINA_HOST:-0.0.0.0}"
export LUMINA_LOG_LEVEL="${LUMINA_LOG_LEVEL:-debug}"

echo "Starting Lumina dev server on http://localhost:${LUMINA_PORT}/"
echo "  config:  ${LUMINA_CONFIG}"
echo "  domains: ${LUMINA_DOMAINS_DIR}"
echo ""

exec bun run --watch src/main.ts
