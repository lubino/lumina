/**
 * Folder index maps to the folder path.
 * File: routes/time/index.ts → URL: /time
 */
export default function handler(_request: Request) {
  return new Response(`Actual server time ${new Date().toISOString()}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
