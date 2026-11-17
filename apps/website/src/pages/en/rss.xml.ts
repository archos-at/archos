import type { APIRoute } from 'astro';
import { blogFeed } from '../../lib/feed';

export const prerender = false;

export const GET: APIRoute = ({ site }) => blogFeed('en', site);
