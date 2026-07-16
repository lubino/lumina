export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  return Response.json({
    hello: params.name ?? "anonymous",
  });
}
