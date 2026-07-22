#!/usr/bin/env bash
# Build Lumina (tests) and publish multi-arch Docker images to GHCR.
#
# Image: ghcr.io/lubino/lumina
# Platforms (default): linux/amd64,linux/arm64  (same as CI)
#
# Usage:
#   ./build-image.sh                 # test + multi-arch build + push
#   ./build-image.sh --skip-tests    # skip bun test / typecheck
#   ./build-image.sh --no-push       # build multi-arch only (no registry push)
#   ./build-image.sh --local         # current host arch only, load into local Docker
#   ./build-image.sh --platforms linux/amd64
#   ./build-image.sh --tag beta      # also tag as ghcr.io/lubino/lumina:beta
#
# Auth (push):
#   echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
#   Token needs write:packages (and read:packages). Classic PAT or fine-grained
#   with Packages write on the lubino/lumina package / repo.
#
# Env overrides:
#   IMAGE_NAME   default ghcr.io/lubino/lumina
#   PLATFORMS    default linux/amd64,linux/arm64
#   BUILDER      buildx builder name (default lumina-multi)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/lubino/lumina}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-lumina-multi}"

SKIP_TESTS=0
NO_PUSH=0
LOCAL=0
EXTRA_TAGS=()

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help) usage 0 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --no-push) NO_PUSH=1; shift ;;
    --local) LOCAL=1; shift ;;
    --platforms)
      PLATFORMS="${2:?--platforms requires a value (e.g. linux/amd64,linux/arm64)}"
      shift 2
      ;;
    --tag)
      EXTRA_TAGS+=("${2:?--tag requires a value}")
      shift 2
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage 1
      ;;
  esac
done

if [[ ! -f package.json ]]; then
  echo "error: package.json not found (run from repo root)" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed or not on PATH" >&2
  exit 1
fi

VERSION="$(
  # Prefer Bun when available; fall back to node/python/sed
  if command -v bun >/dev/null 2>&1; then
    bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)'
  elif command -v node >/dev/null 2>&1; then
    node -p 'require("./package.json").version'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json; print(json.load(open("package.json"))["version"])'
  else
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1
  fi
)"
if [[ -z "${VERSION}" ]]; then
  echo "error: could not read version from package.json" >&2
  exit 1
fi

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
FULL_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

# --- project checks (host) -------------------------------------------------

if [[ "${SKIP_TESTS}" -eq 0 ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "error: bun is required for tests (or pass --skip-tests)" >&2
    echo "Install from https://bun.sh" >&2
    exit 1
  fi
  if [[ ! -d node_modules ]]; then
    echo "==> bun install"
    bun install --frozen-lockfile
  fi
  echo "==> bun test"
  bun test
  echo "==> bun run typecheck"
  bun run typecheck
else
  echo "==> skipping host tests (--skip-tests)"
fi

# --- tags ------------------------------------------------------------------

TAGS=(
  "${IMAGE_NAME}:${VERSION}"
  "${IMAGE_NAME}:sha-${GIT_SHA}"
)
# latest only when pushing a release-style multi-arch image (not --local only)
if [[ "${LOCAL}" -eq 0 ]]; then
  TAGS+=("${IMAGE_NAME}:latest")
fi
for t in "${EXTRA_TAGS[@]+"${EXTRA_TAGS[@]}"}"; do
  TAGS+=("${IMAGE_NAME}:${t}")
done

TAG_ARGS=()
for t in "${TAGS[@]}"; do
  TAG_ARGS+=(--tag "$t")
done

echo "==> image tags"
for t in "${TAGS[@]}"; do
  echo "    $t"
done
echo "    version=${VERSION}  git=${GIT_SHA}  platforms=${PLATFORMS}"

# --- docker buildx ---------------------------------------------------------

ensure_builder() {
  if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
    echo "==> creating buildx builder: ${BUILDER}"
    docker buildx create --name "${BUILDER}" --driver docker-container --use
  else
    docker buildx use "${BUILDER}"
  fi
  # QEMU for cross-arch (arm64 on amd64 hosts and vice versa)
  if [[ "${LOCAL}" -eq 0 ]]; then
    docker buildx inspect --bootstrap >/dev/null
  fi
}

LABEL_ARGS=(
  --label "org.opencontainers.image.title=Lumina"
  --label "org.opencontainers.image.description=Lightweight multi-domain HTTP server"
  --label "org.opencontainers.image.version=${VERSION}"
  --label "org.opencontainers.image.revision=${FULL_SHA}"
  --label "org.opencontainers.image.source=https://github.com/lubino/lumina"
  --label "org.opencontainers.image.licenses=AGPL-3.0-only"
)

if [[ "${LOCAL}" -eq 1 ]]; then
  # Single-platform load into local docker daemon (no multi-arch manifest push)
  HOST_ARCH="$(docker version -f '{{.Server.Arch}}' 2>/dev/null || uname -m)"
  case "${HOST_ARCH}" in
    x86_64 | amd64) LOCAL_PLATFORM="linux/amd64" ;;
    aarch64 | arm64) LOCAL_PLATFORM="linux/arm64" ;;
    *) LOCAL_PLATFORM="linux/${HOST_ARCH}" ;;
  esac
  echo "==> docker buildx build (local load, ${LOCAL_PLATFORM})"
  ensure_builder
  docker buildx build \
    --platform "${LOCAL_PLATFORM}" \
    --load \
    "${TAG_ARGS[@]}" \
    "${LABEL_ARGS[@]}" \
    --file "${ROOT}/Dockerfile" \
    "${ROOT}"
  echo "==> loaded into local Docker:"
  for t in "${TAGS[@]}"; do
    echo "    $t"
  done
  exit 0
fi

ensure_builder

if [[ "${NO_PUSH}" -eq 1 ]]; then
  echo "==> docker buildx build (no push, platforms=${PLATFORMS})"
  # Multi-arch images cannot --load into a single daemon; build only (cache).
  docker buildx build \
    --platform "${PLATFORMS}" \
    "${TAG_ARGS[@]}" \
    "${LABEL_ARGS[@]}" \
    --file "${ROOT}/Dockerfile" \
    "${ROOT}"
  echo "==> build finished (not pushed; use without --no-push to upload)"
  exit 0
fi

# Verify registry login for GHCR when pushing
if [[ "${IMAGE_NAME}" == ghcr.io/* ]]; then
  if ! docker system info 2>/dev/null | grep -qi 'ghcr.io' \
    && ! grep -q 'ghcr.io' "${HOME}/.docker/config.json" 2>/dev/null; then
    echo "warning: may not be logged in to ghcr.io" >&2
    echo "  echo \"\$GITHUB_TOKEN\" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin" >&2
  fi
fi

echo "==> docker buildx build --push (platforms=${PLATFORMS})"
docker buildx build \
  --platform "${PLATFORMS}" \
  --push \
  "${TAG_ARGS[@]}" \
  "${LABEL_ARGS[@]}" \
  --file "${ROOT}/Dockerfile" \
  "${ROOT}"

echo ""
echo "==> published"
for t in "${TAGS[@]}"; do
  echo "    $t"
done
echo ""
echo "Pull example:"
echo "  docker pull ${IMAGE_NAME}:${VERSION}"
echo "  docker pull ${IMAGE_NAME}:latest"
