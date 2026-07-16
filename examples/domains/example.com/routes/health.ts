/**
 * Simple health endpoint.
 * File: routes/health.ts → URL: /health
 */
export default function handler(_request: Request) {
  return Response.json({ status: "ok" });
}
