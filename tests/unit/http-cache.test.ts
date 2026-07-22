import { describe, expect, test } from "bun:test";
import {
  cacheControlForPathname,
  contentHashETag,
  etagMatches,
  fileETag,
  IMMUTABLE_CACHE_CONTROL,
  isFingerprintedPathname,
  isNotModified,
  notModifiedSince,
  STATIC_CACHE_CONTROL,
  toHttpDate,
} from "../../src/caching/http-cache";

describe("fileETag", () => {
  test("formats strong etag from mtime and size", () => {
    expect(fileETag(0, 0)).toBe('"0-0"');
    expect(fileETag(255, 16)).toBe('"ff-10"');
  });

  test("truncates fractional mtime", () => {
    expect(fileETag(1000.9, 1)).toBe(fileETag(1000, 1));
  });
});

describe("contentHashETag", () => {
  test("is stable for same bytes and content-hash shaped", () => {
    const a = contentHashETag(Buffer.from("hello"));
    const b = contentHashETag(Buffer.from("hello"));
    expect(a).toBe(b);
    expect(a).toMatch(/^"h[0-9a-f]{16}"$/);
  });

  test("differs when content differs", () => {
    expect(contentHashETag(Buffer.from("a"))).not.toBe(
      contentHashETag(Buffer.from("b")),
    );
  });
});

describe("isFingerprintedPathname", () => {
  test("matches hex content-hash basenames", () => {
    expect(isFingerprintedPathname("/assets/app.a1b2c3d4.js")).toBe(true);
    expect(isFingerprintedPathname("/css/style.deadbeef.css")).toBe(true);
    expect(isFingerprintedPathname("/f.12345678.woff2")).toBe(true);
  });

  test("matches alnum hashes that contain a digit", () => {
    expect(isFingerprintedPathname("/assets/index-B2xK9fQa.js")).toBe(true);
  });

  test("rejects plain names and html", () => {
    expect(isFingerprintedPathname("/assets/style.css")).toBe(false);
    expect(isFingerprintedPathname("/index.html")).toBe(false);
    expect(isFingerprintedPathname("/jquery.min.js")).toBe(false);
    expect(isFingerprintedPathname("/app.bundle.js")).toBe(false);
  });

  test("cacheControlForPathname selects policy", () => {
    expect(cacheControlForPathname("/a.b1c2d3e4.js")).toBe(
      IMMUTABLE_CACHE_CONTROL,
    );
    expect(cacheControlForPathname("/style.css")).toBe(STATIC_CACHE_CONTROL);
  });
});

describe("etagMatches", () => {
  const etag = fileETag(1_700_000_000_000, 42);

  test("matches exact etag", () => {
    expect(etagMatches(etag, etag)).toBe(true);
  });

  test("matches weak form", () => {
    expect(etagMatches(`W/${etag}`, etag)).toBe(true);
  });

  test("matches one of a list", () => {
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
  });

  test("star matches any", () => {
    expect(etagMatches("*", etag)).toBe(true);
  });

  test("null / empty / mismatch", () => {
    expect(etagMatches(null, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
    expect(etagMatches('"nope"', etag)).toBe(false);
  });
});

describe("notModifiedSince", () => {
  const mtime = Date.parse("Wed, 01 Jan 2020 12:00:00 GMT");

  test("true when resource older or equal to IMS", () => {
    expect(notModifiedSince("Wed, 01 Jan 2020 12:00:00 GMT", mtime)).toBe(
      true,
    );
    expect(notModifiedSince("Thu, 02 Jan 2020 12:00:00 GMT", mtime)).toBe(
      true,
    );
  });

  test("false when resource newer than IMS", () => {
    expect(notModifiedSince("Tue, 31 Dec 2019 12:00:00 GMT", mtime)).toBe(
      false,
    );
  });

  test("false for missing or invalid date", () => {
    expect(notModifiedSince(null, mtime)).toBe(false);
    expect(notModifiedSince("not-a-date", mtime)).toBe(false);
  });
});

describe("isNotModified", () => {
  const mtime = 1_700_000_000_000;
  const etag = fileETag(mtime, 100);

  test("If-None-Match takes precedence over If-Modified-Since", () => {
    const req = new Request("http://x/", {
      headers: {
        "If-None-Match": etag,
        // Would be "modified" if IMS alone were used (mtime far in future)
        "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
      },
    });
    expect(isNotModified(req, etag, mtime)).toBe(true);
  });

  test("mismatched If-None-Match does not fall back to IMS", () => {
    const req = new Request("http://x/", {
      headers: {
        "If-None-Match": '"other"',
        "If-Modified-Since": toHttpDate(mtime + 60_000),
      },
    });
    expect(isNotModified(req, etag, mtime)).toBe(false);
  });

  test("IMS alone can yield not modified", () => {
    const req = new Request("http://x/", {
      headers: { "If-Modified-Since": toHttpDate(mtime) },
    });
    expect(isNotModified(req, etag, mtime)).toBe(true);
  });

  test("only GET/HEAD", () => {
    const req = new Request("http://x/", {
      method: "POST",
      headers: { "If-None-Match": etag },
    });
    expect(isNotModified(req, etag, mtime)).toBe(false);
  });
});
