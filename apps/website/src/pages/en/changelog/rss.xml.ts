import type { APIRoute } from 'astro';
import { changelogFeed } from '../../../lib/changelog';

export const GET: APIRoute = ({ site }) => changelogFeed('en', site);
