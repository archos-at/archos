/**
 * The blog's posts, from the CMS when the server has one (`CMS_URL` and
 * `CMS_API_KEY`, ADR-0155) and from the MDX fixtures in src/content/blog when it
 * has none: a local build, CI, and every check run without a CMS. The routes are
 * rendered on request, so a post published in the CMS is on the site without a
 * build (src/lib/cms.ts keeps it fresh).
 */
import { getCollection } from 'astro:content';
import type { Locale } from '../i18n/paths';
import { blogPath, type Category } from './categories';
import { cmsSettings, getCmsPosts } from './cms';
import { fromCms, fromFixture, type Post } from './post-model';

export type { Post } from './post-model';

/**
 * Preview builds render drafts. Set only for a local preview
 * (`PUBLIC_INCLUDE_DRAFTS=1 bun run build`), never by a release build: a truthy value there would publish every unfinished draft.
 * Fixtures only: the CMS serves what is published, and drafts are previewed there.
 */
const includeDrafts = import.meta.env.PUBLIC_INCLUDE_DRAFTS === '1';

/**
 * Every post in `locale`, from whichever source this server has. The blog stays
 * on the MDX fixtures the site was built with while the CMS cannot stand in for
 * them:
 *
 * - the CMS does not answer and no copy of its posts is in memory yet (a pod that
 *   just started, or a CMS that is down): the blog keeps its posts instead of a 500;
 * - the CMS answers with no published post at all: it was just switched on and
 *   the fixtures are not imported yet (`bun run import:blog apply` in apps/cms).
 *   From the first published post on, the CMS is the source.
 */
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

/** Posts for one locale, newest first, drafts hidden outside preview builds. */
export async function getBlogPosts(locale: Locale, category?: Category): Promise<Post[]> {
  const posts = (await allPosts(locale)).filter((p) => !category || p.category === category);
  return posts.sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());
}

export type PostLookup = { post: Post } | { redirect: string } | undefined;

/** The post at `slug`, or where a former slug of a post now lives, or nothing. */
export async function findPost(locale: Locale, slug: string): Promise<PostLookup> {
  const posts = await allPosts(locale);
  const post = posts.find((p) => p.slug === slug);
  if (post) return { post };
  const moved = posts.find((p) => p.previousSlugs.includes(slug));
  return moved ? { redirect: postPath(locale, moved) } : undefined;
}

/** Dates as the blog prints them: long form, in the locale's own order. */
export function formatDate(date: Date, locale: Locale) {
  return date.toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-AT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The URL of a post in `locale`: `/blog/<slug>/` or `/en/blog/<slug>/`. */
export function postPath(locale: Locale, post: Pick<Post, 'slug'>) {
  return `${blogPath(locale)}${post.slug}/`;
}

/**
 * Cache-Control of a blog page: browsers keep it a minute and may show it stale
 * for ten while they fetch the new one; the CMS copy behind it is as fresh.
 */
export const BLOG_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';
