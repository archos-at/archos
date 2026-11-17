import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { invalidateCmsPosts } from '../../../lib/cms';

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
