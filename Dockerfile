# Multi-stage: ALL install/compile happens here — never on stack hosts.
# Runtime is Alpine: much smaller than Debian slim (git ~10MB vs ~120MB with Perl deps).
FROM oven/bun:1-alpine AS build
WORKDIR /src
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun build ./src/main.ts --outdir=/out --target=bun --minify

FROM oven/bun:1-alpine
RUN apk add --no-cache git ca-certificates \
  && addgroup -S lumina \
  && adduser -S -G lumina -h /app -s /sbin/nologin lumina
WORKDIR /app
COPY --from=build /out /app
RUN mkdir -p /config /data/domains /data/git-cache /data/secrets \
  && chown -R lumina:lumina /config /data /app
ENV LUMINA_CONFIG=/config/config.yaml \
    LUMINA_DOMAINS_DIR=/data/domains \
    LUMINA_GIT_CACHE_DIR=/data/git-cache \
    LUMINA_HOST=0.0.0.0 \
    LUMINA_PORT=3030
EXPOSE 3030
USER lumina
# Immediate start — no install, no compile, no download
ENTRYPOINT ["bun", "/app/main.js"]
