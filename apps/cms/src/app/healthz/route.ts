/**
 * Liveness and readiness for the kubelet: answers once the server listens, and
 * touches neither the database nor Payload, so a slow database restarts nothing.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
}
