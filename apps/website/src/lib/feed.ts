import rss from '@astrojs/rss';
import copy from '../i18n/pages/blog';
import type { Locale } from '../i18n/paths';
import { t } from '../i18n/ui';
import { CATEGORIES, blogPath } from './categories';
import identity from './identity';
import { BLOG_CACHE_CONTROL, getBlogPosts, postPath } from './posts';

const LANGUAGE: Record<Locale, string> = { de: '<language>de-at</language>', en: '<language>en</language>' };

export async function blogFeed(locale: Locale, site: URL | undefined) {
  const posts = await getBlogPosts(locale);
  const feed = await rss({
    title: t(locale).rssTitle,
    description: copy[locale].hero.text,
    site: new URL(blogPath(locale), site ?? `https://${identity.domain}`).href,
    trailingSlash: true,
    customData: LANGUAGE[locale],
    items: posts.map((post) => ({
      title: post.title,
      description: post.description,
      pubDate: post.pubDate,
      link: postPath(locale, post),
      categories: [CATEGORIES[locale][post.category].label],
    })),
  });
  feed.headers.set('Cache-Control', BLOG_CACHE_CONTROL);
  return feed;
}
