/**
 * Nested dynamic segment.
 * File: routes/users/[id]/profile.ts → URL: /users/:id/profile
 */
export default function handler(
  _request: Request,
  params: Record<string, string>,
) {
  return Response.json({
    userId: params.id,
    profile: true,
  });
}
