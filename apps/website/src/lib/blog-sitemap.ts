/**
 * The entries of the blog's sitemap (src/pages/sitemap-blog.xml.ts): the listing and its
 * category pages in both locales, and every indexable post, each with its twin and its date.
 * Pure, for its tests.
 */
import { ROUTES, type Locale } from '../i18n/paths';
import { CATEGORY_IDS, blogPath } from './categories';
import type { Post } from './post-model';

export type SitemapEntry = { path: string; pair?: Record<Locale, string>; lastmod?: Date };

const LOCALES: Locale[] = ['de', 'en'];
const postPath = (locale: Locale, post: Post) => `${blogPath(locale)}${post.slug}/`;

export function blogEntries(posts: Record<Locale, Post[]>): SitemapEntry[] {
  const newest = LOCALES.flatMap((l) => posts[l]).map((p) => p.updated ?? p.pubDate).sort((a, b) => b.valueOf() - a.valueOf())[0];
  const entries: SitemapEntry[] = [];
  for (const locale of LOCALES) {
    entries.push({ path: ROUTES.blog[locale], pair: ROUTES.blog, lastmod: newest });
    for (const category of CATEGORY_IDS) {
      entries.push({ path: blogPath(locale, category), pair: { de: blogPath('de', category), en: blogPath('en', category) }, lastmod: newest });
    }
    const other: Locale = locale === 'de' ? 'en' : 'de';
    for (const post of posts[locale].filter((p) => !p.noindex)) {
      const twin = post.translationSlug && posts[other].find((p) => p.slug === post.translationSlug && !p.noindex);
      const own = postPath(locale, post);
      const pair = twin ? ({ [locale]: own, [other]: postPath(other, twin) } as Record<Locale, string>) : undefined;
      entries.push({ path: own, pair, lastmod: post.updated ?? post.pubDate });
    }
  }
  return entries;
}
