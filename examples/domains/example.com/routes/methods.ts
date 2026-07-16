/**
 * Branch on HTTP method inside one file.
 * File: routes/methods.ts → URL: /methods
 */
export default async function handler(request: Request) {
  switch (request.method) {
    case "GET":
      return Response.json({ method: "GET", message: "read" });
    case "POST": {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return Response.json({ method: "POST", received: body }, { status: 201 });
    }
    case "DELETE":
      return new Response(null, { status: 204 });
    default:
      return Response.json(
        { error: "Method not allowed", method: request.method },
        { status: 405, headers: { Allow: "GET, POST, DELETE" } },
      );
  }
}
