import type { APIRoute } from 'astro'

// Static robots.txt: every page may be crawled, and both sitemaps are named: the index of the
// prerendered pages and the blog's, which is rendered on request (src/pages/sitemap-blog.xml.ts).
export const prerender = true

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap-index.xml', site)}\nSitemap: ${new URL('sitemap-blog.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
