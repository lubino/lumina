/**
 * Catch-all segment (one or more remaining path parts joined by "/").
 * File: routes/docs/[...slug].ts → URL: /docs/* 
 * Examples: /docs/a → slug "a", /docs/a/b/c → slug "a/b/c"
 */
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  const slug = params.slug ?? "";
  const parts = slug.length > 0 ? slug.split("/") : [];
  return Response.json({
    section: "docs",
    slug,
    parts,
  });
}
