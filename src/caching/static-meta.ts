import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  BODY_CACHE_MAX_ENTRY_BYTES,
  BODY_CACHE_MAX_TOTAL_BYTES,
  CONTENT_HASH_MAX_BYTES,
  contentHashETag,
  fileETag,
  toHttpDate,
} from "./http-cache";

export interface FileMeta {
  path: string;
  mtimeMs: number;
  size: number;
  etag: string;
  lastModified: string;
  contentType: string;
  /** Generation of the domain root when this entry was stored. */
  generation: number;
  /** True when etag is a content hash (small files). */
  contentHashed: boolean;
  /**
   * Optional in-memory body for tiny files (≤ BODY_CACHE_MAX_ENTRY_BYTES).
   * Dropped under total budget pressure or generation bump.
   */
  body?: Uint8Array;
}

/**
 * In-memory metadata (+ optional tiny body) cache for static files.
 *
 * Validity is tied to a per-root **generation** counter. Bump the generation
 * when Lumina knows the tree changed (FS watch, git sync, config reload).
 *
 * Small files (≤ CONTENT_HASH_MAX_BYTES) get a content-hash ETag so identity
 * survives mtime quirks after git checkout. Tiny files may also keep a body
 * buffer under a global byte budget (LRU by insertion order).
 */
export class StaticMetaCache {
  /** Normalized absolute domain root → generation (starts at 0). */
  private generations = new Map<string, number>();
  /** Absolute file path → cached identity. Insertion order = LRU for bodies. */
  private meta = new Map<string, FileMeta>();
  private bodyBytes = 0;

  /** Normalize a domain root or file path for map keys. */
  normalize(path: string): string {
    return resolve(path);
  }

  sameRoot(a: string, b: string): boolean {
    return this.normalize(a) === this.normalize(b);
  }

  generation(root: string): number {
    return this.generations.get(this.normalize(root)) ?? 0;
  }

  /**
   * Advance the root generation and drop all cached meta under that root.
   * Safe to call multiple times; returns the new generation.
   */
  bumpGeneration(root: string): number {
    const key = this.normalize(root);
    const next = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, next);
    this.dropMetaUnderRoot(key);
    return next;
  }

  /** Drop a single file entry (fine-grained; generation unchanged). */
  invalidatePath(absPath: string): void {
    const key = this.normalize(absPath);
    const entry = this.meta.get(key);
    if (entry) {
      this.releaseBody(entry);
      this.meta.delete(key);
    }
  }

  getMeta(absPath: string, root: string): FileMeta | null {
    const key = this.normalize(absPath);
    const entry = this.meta.get(key);
    if (!entry) return null;
    if (entry.generation !== this.generation(root)) {
      this.releaseBody(entry);
      this.meta.delete(key);
      return null;
    }
    // Refresh LRU order for body-bearing entries
    if (entry.body) {
      this.meta.delete(key);
      this.meta.set(key, entry);
    }
    return entry;
  }

  /**
   * Return cached meta or stat (+ optional hash/body) and store.
   * Returns null if the path is missing or not a regular file.
   */
  getOrStat(
    absPath: string,
    root: string,
    contentType: string,
  ): FileMeta | null {
    const cached = this.getMeta(absPath, root);
    if (cached) return cached;

    try {
      const st = statSync(absPath);
      if (!st.isFile()) return null;
      const mtimeMs = st.mtimeMs;
      const size = st.size;
      const pathKey = this.normalize(absPath);
      const generation = this.generation(root);

      let etag: string;
      let contentHashed = false;
      let body: Uint8Array | undefined;

      if (size <= CONTENT_HASH_MAX_BYTES) {
        const buf = readFileSync(absPath);
        etag = contentHashETag(buf);
        contentHashed = true;
        if (size <= BODY_CACHE_MAX_ENTRY_BYTES) {
          const bytes = Uint8Array.from(buf);
          this.ensureBodyBudget(bytes.byteLength);
          if (this.bodyBytes + bytes.byteLength <= BODY_CACHE_MAX_TOTAL_BYTES) {
            body = bytes;
            this.bodyBytes += bytes.byteLength;
          }
        }
      } else {
        etag = fileETag(mtimeMs, size);
      }

      const entry: FileMeta = {
        path: pathKey,
        mtimeMs,
        size,
        etag,
        lastModified: toHttpDate(mtimeMs),
        contentType,
        generation,
        contentHashed,
        body,
      };

      this.meta.set(pathKey, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /** Bytes currently held in body buffers. */
  bodyCacheBytes(): number {
    return this.bodyBytes;
  }

  /** Test / ops helper — number of meta entries. */
  size(): number {
    return this.meta.size;
  }

  clear(): void {
    this.meta.clear();
    this.generations.clear();
    this.bodyBytes = 0;
  }

  private releaseBody(entry: FileMeta): void {
    if (entry.body) {
      this.bodyBytes -= entry.body.byteLength;
      if (this.bodyBytes < 0) this.bodyBytes = 0;
      entry.body = undefined;
    }
  }

  /**
   * Evict oldest body-bearing entries (Map insertion order) until
   * bodyBytes + needed ≤ BODY_CACHE_MAX_TOTAL_BYTES.
   */
  private ensureBodyBudget(needed: number): void {
    if (needed > BODY_CACHE_MAX_TOTAL_BYTES) {
      // Should not happen when BODY_CACHE_MAX_ENTRY ≤ TOTAL; refuse body.
      return;
    }
    while (
      this.bodyBytes + needed > BODY_CACHE_MAX_TOTAL_BYTES &&
      this.meta.size > 0
    ) {
      let evicted = false;
      for (const [key, entry] of this.meta) {
        if (!entry.body) continue;
        this.releaseBody(entry);
        // Keep meta (etag still valid); only drop body
        this.meta.delete(key);
        this.meta.set(key, entry);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  private dropMetaUnderRoot(rootKey: string): void {
    const prefix = rootKey.endsWith(sep) ? rootKey : rootKey + sep;
    for (const key of [...this.meta.keys()]) {
      if (key === rootKey || key.startsWith(prefix)) {
        const entry = this.meta.get(key);
        if (entry) this.releaseBody(entry);
        this.meta.delete(key);
      }
    }
  }
}
