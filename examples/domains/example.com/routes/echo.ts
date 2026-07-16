/**
 * Echo method, query string, and JSON body (if present).
 * File: routes/echo.ts → URL: /echo
 */
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  let body: unknown = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    contentType.includes("application/json")
  ) {
    try {
      body = await request.json();
    } catch {
      body = { error: "invalid JSON body" };
    }
  }

  return Response.json({
    method: request.method,
    path: url.pathname,
    query,
    body,
  });
}
