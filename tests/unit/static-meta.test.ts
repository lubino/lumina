import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StaticMetaCache } from "../../src/caching/static-meta";
import { fileETag } from "../../src/caching/http-cache";

describe("StaticMetaCache", () => {
  test("getOrStat caches by path and skips re-stat until generation bumps", () => {
    const root = join(tmpdir(), `lumina-meta-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const file = join(root, "a.txt");
    writeFileSync(file, "hello");
    // utimes numbers < 1e10 are seconds → mtimeMs = sec * 1000
    utimesSync(file, 1_600_000_000, 1_600_000_000);

    const cache = new StaticMetaCache();
    try {
      const first = cache.getOrStat(file, root, "text/plain");
      expect(first).not.toBeNull();
      expect(first!.size).toBe(5);
      // Small files: content-hash ETag, not mtime-size
      expect(first!.contentHashed).toBe(true);
      expect(first!.etag).toMatch(/^"h[0-9a-f]{16}"$/);
      expect(first!.body?.byteLength).toBe(5);
      expect(cache.size()).toBe(1);

      // Mutate file without bumping — cache still returns old identity
      writeFileSync(file, "hello!!");
      utimesSync(file, 1_700_000_000, 1_700_000_000);
      const stale = cache.getOrStat(file, root, "text/plain");
      expect(stale!.etag).toBe(first!.etag);
      expect(stale!.size).toBe(5);
      expect(cache.size()).toBe(1);

      cache.bumpGeneration(root);
      expect(cache.size()).toBe(0);
      expect(cache.generation(root)).toBe(1);
      expect(cache.bodyCacheBytes()).toBe(0);

      const fresh = cache.getOrStat(file, root, "text/plain");
      expect(fresh!.etag).not.toBe(first!.etag);
      expect(fresh!.size).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("large files use identity ETag and no body buffer", () => {
    const root = join(tmpdir(), `lumina-meta-large-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const file = join(root, "big.bin");
    // > CONTENT_HASH_MAX_BYTES (256 KiB)
    const big = Buffer.alloc(256 * 1024 + 1, 7);
    writeFileSync(file, big);
    utimesSync(file, 1_600_000_000, 1_600_000_000);

    const cache = new StaticMetaCache();
    try {
      const meta = cache.getOrStat(file, root, "application/octet-stream");
      expect(meta).not.toBeNull();
      expect(meta!.contentHashed).toBe(false);
      expect(meta!.body).toBeUndefined();
      expect(meta!.etag).toBe(fileETag(meta!.mtimeMs, meta!.size));
      expect(cache.bodyCacheBytes()).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("invalidatePath drops one entry without bumping generation", () => {
    const root = join(tmpdir(), `lumina-meta-inv-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const a = join(root, "a.txt");
    const b = join(root, "b.txt");
    writeFileSync(a, "a");
    writeFileSync(b, "b");

    const cache = new StaticMetaCache();
    try {
      cache.getOrStat(a, root, "text/plain");
      cache.getOrStat(b, root, "text/plain");
      expect(cache.size()).toBe(2);
      expect(cache.generation(root)).toBe(0);

      cache.invalidatePath(a);
      expect(cache.size()).toBe(1);
      expect(cache.getMeta(a, root)).toBeNull();
      expect(cache.getMeta(b, root)).not.toBeNull();
      expect(cache.generation(root)).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("bumpGeneration only drops meta under that root", () => {
    const base = join(tmpdir(), `lumina-meta-roots-${Date.now()}`);
    const rootA = join(base, "a");
    const rootB = join(base, "b");
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const fileA = join(rootA, "x.txt");
    const fileB = join(rootB, "x.txt");
    writeFileSync(fileA, "a");
    writeFileSync(fileB, "b");

    const cache = new StaticMetaCache();
    try {
      cache.getOrStat(fileA, rootA, "text/plain");
      cache.getOrStat(fileB, rootB, "text/plain");
      expect(cache.size()).toBe(2);

      cache.bumpGeneration(rootA);
      expect(cache.getMeta(fileA, rootA)).toBeNull();
      expect(cache.getMeta(fileB, rootB)).not.toBeNull();
      expect(cache.generation(rootA)).toBe(1);
      expect(cache.generation(rootB)).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("sameRoot normalizes relative vs absolute", () => {
    const cache = new StaticMetaCache();
    const abs = resolveFixture();
    expect(cache.sameRoot(abs, abs)).toBe(true);
  });
});

function resolveFixture(): string {
  return join(import.meta.dir, "../../examples/domains/example.com");
}
