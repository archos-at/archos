import type { APIRoute } from 'astro';
import { blogFeed } from '../../lib/feed';

// On request, like the blog itself (ADR-0155): a post published in the CMS is in the feed at once.
export const prerender = false;

export const GET: APIRoute = ({ site }) => blogFeed('en', site);
