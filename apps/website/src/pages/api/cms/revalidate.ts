import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { invalidateCmsPosts } from '../../../lib/cms';

// The CMS's `Refresh the website` flow (ADR-0155, apps/cms) posts here when a post changes,
// with `Authorization: Bearer <CMS_REVALIDATE_TOKEN>`: the posts this pod holds turn stale and
// the next request reads the CMS. Without the token configured the address does not exist.
export const prerender = false;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: APIRoute = ({ request }) => {
  const token = process.env.CMS_REVALIDATE_TOKEN?.trim();
  if (!token) return new Response(null, { status: 404 });
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${token}`)) return new Response(null, { status: 401 });
  invalidateCmsPosts();
  return new Response(null, { status: 204 });
};
