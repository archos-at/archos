import { getCollection } from 'astro:content';
import type { Locale } from '../i18n/paths';
import { blogPath, type Category } from './categories';
import { cmsSettings, getCmsPosts } from './cms';
import { fromCms, fromFixture, type Post } from './post-model';

export type { Post } from './post-model';

const includeDrafts = import.meta.env.PUBLIC_INCLUDE_DRAFTS === '1';

async function allPosts(locale: Locale): Promise<Post[]> {
  const settings = cmsSettings();
  if (settings) {
    try {
      const live = await getCmsPosts(settings);
      if (live.length > 0) return live.map((p) => fromCms(p, locale)).filter((p): p is Post => p !== undefined);
      console.warn('cms: no published post yet, serving the built-in posts until the import');
    } catch (error) {
      console.error(`cms: unreachable and nothing cached, serving the built-in posts: ${String(error)}`);
    }
  }
  const entries = await getCollection('blog', ({ id, data }) => (includeDrafts || !data.draft) && id.startsWith(`${locale}/`));
  return entries.map(fromFixture);
}

export async function getBlogPosts(locale: Locale, category?: Category): Promise<Post[]> {
  const posts = (await allPosts(locale)).filter((p) => !category || p.category === category);
  return posts.sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());
}

export type PostLookup = { post: Post } | { redirect: string } | undefined;

export async function findPost(locale: Locale, slug: string): Promise<PostLookup> {
  const posts = await allPosts(locale);
  const post = posts.find((p) => p.slug === slug);
  if (post) return { post };
  const moved = posts.find((p) => p.previousSlugs.includes(slug));
  return moved ? { redirect: postPath(locale, moved) } : undefined;
}

export function formatDate(date: Date, locale: Locale) {
  return date.toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-AT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function postPath(locale: Locale, post: Pick<Post, 'slug'>) {
  return `${blogPath(locale)}${post.slug}/`;
}

export const BLOG_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';
