export default function handler(_request: Request) {
  return Response.json({
    ok: true,
    service: "lumina",
    route: "/api",
    time: new Date().toISOString(),
  });
}
