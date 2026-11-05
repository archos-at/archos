import type { APIRoute } from 'astro';
import type { Locale } from '../i18n/paths';
import { blogEntries, type SitemapEntry } from '../lib/blog-sitemap';
import identity from '../lib/identity';
import { BLOG_CACHE_CONTROL, getBlogPosts } from '../lib/posts';

// The blog's sitemap, on request like the blog (ADR-0155), so a post published in the CMS is
// listed at once; robots.txt names it beside the sitemap index @astrojs/sitemap builds for the
// prerendered pages. Each URL carries its twin as hreflang alternates and its date: a post's
// last change, the listings' newest post.
export const prerender = false;

const LOCALES: Locale[] = ['de', 'en'];

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function urlXml(site: URL, { path, pair, lastmod }: SitemapEntry): string {
  const links = pair
    ? LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${escape(new URL(pair[l], site).href)}"/>`).join('')
    : '';
  const date = lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : '';
  return `<url><loc>${escape(new URL(path, site).href)}</loc>${links}${date}</url>`;
}

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL(`https://${identity.domain}`);
  const posts = { de: await getBlogPosts('de'), en: await getBlogPosts('en') };
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    blogEntries(posts).map((e) => urlXml(base, e)).join('') +
    '</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': BLOG_CACHE_CONTROL } });
};
