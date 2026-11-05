import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blogEntries } from './blog-sitemap';
import { assetUrl, authorization, cmsSettings, fetchCmsPosts, postsUrl, swrCache } from './cms';
import { previewRequestUrl } from './cms-preview';
import { fromCms, type CmsPost, type Post } from './post-model';

const text = (value: string, format = 0) => ({ type: 'text', version: 1, detail: 0, format, mode: 'normal', style: '', text: value });
const body = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } });

/** A post as the CMS answers `postsUrl` (`locale=all&depth=1`; shape read from Payload 3.93.0 on 2026-11-05). */
const CMS_POST: CmsPost = {
  id: 3,
  publishedAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  category: 'technology',
  coverType: 'drawing',
  cover: 'answer-pipeline',
  coverImage: null,
  coverAlt: null,
  author: { name: 'Anna Muster', jobTitle: { de: 'Architektin', en: 'Architect' }, profileUrl: null },
  title: { de: 'Wie das Arbeits­buch funktioniert', en: 'How it works' },
  slug: { de: 'so-arbeitet-der-workspace', en: 'how-the-workspace-works' },
  description: { de: 'Ein Rundgang.', en: 'A tour.' },
  seo: { title: { de: null, en: null }, description: { de: '', en: null }, noindex: { de: false, en: false } },
  previousSlugs: { de: ['alter-slug'], en: [] },
  body: { de: body({ type: 'paragraph', children: [text('Absatz.')] }), en: body() },
};

describe('a CMS post', () => {
  test('becomes the post the views render, per locale, with its twin', () => {
    const de = fromCms(CMS_POST, 'de')!;
    expect(de.slug).toBe('so-arbeitet-der-workspace');
    expect(de.heading).toContain('­');
    expect(de.title).toBe('Wie das Arbeitsbuch funktioniert');
    expect(de.translationSlug).toBe('how-the-workspace-works');
    expect(de.cover).toEqual({ kind: 'drawing', id: 'answer-pipeline' });
    expect(de.seoDescription).toBeUndefined();
    expect(de.previousSlugs).toEqual(['alter-slug']);
    expect(de.updated?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(de.author).toEqual({ name: 'Anna Muster', jobTitle: 'Architektin', url: undefined });
    expect(de.body.kind).toBe('rich-text');
    expect(fromCms(CMS_POST, 'en')!.author?.jobTitle).toBe('Architect');
  });

  test('is left out where the site cannot show it', () => {
    expect(fromCms({ ...CMS_POST, slug: { de: 'nur-deutsch', en: null } }, 'en')).toBeUndefined();
    expect(fromCms({ ...CMS_POST, slug: { de: 'nur-deutsch', en: null } }, 'de')?.translationSlug).toBeUndefined();
    expect(fromCms({ ...CMS_POST, category: 'news' }, 'de')).toBeUndefined();
    expect(fromCms({ ...CMS_POST, body: { de: { blocks: [] } } }, 'de')).toBeUndefined();
    const file = { url: '/api/media/file/f1.png', aiGenerated: true, sizes: { share: { url: '/api/media/file/f1-1200x630.jpg' } } };
    expect(fromCms({ ...CMS_POST, coverType: 'image', coverImage: file, coverAlt: { de: null } }, 'de')).toBeUndefined();
    // An image that did not populate (an id) is no cover either.
    expect(fromCms({ ...CMS_POST, coverType: 'image', coverImage: 9, coverAlt: { de: 'Ein Plan' } }, 'de')).toBeUndefined();
    const image = fromCms({ ...CMS_POST, coverType: 'image', coverImage: file, coverAlt: { de: 'Ein Plan' } }, 'de');
    expect(image?.cover).toEqual({ kind: 'image', file, alt: 'Ein Plan', aiGenerated: true });
  });
});

describe('the CMS client', () => {
  test('reads only with a URL and an API key, and serves images from the public URL', () => {
    expect(cmsSettings({})).toBeUndefined();
    expect(cmsSettings({ CMS_URL: 'http://cms:3000' })).toBeUndefined();
    const settings = cmsSettings({ CMS_URL: 'http://cms:3000', CMS_API_KEY: 'k', CMS_PUBLIC_URL: 'https://cms.example.com/' })!;
    const file = { url: 'http://cms:3000/api/media/file/a%20b.png', sizes: { share: { url: '/api/media/file/a%20b-1200x630.jpg' } } };
    expect(assetUrl(settings, file, 'share')).toBe('https://cms.example.com/api/media/file/a%20b-1200x630.jpg');
    // A size the CMS did not make (an image smaller than it) is the original.
    expect(assetUrl(settings, file, 'cover')).toBe('https://cms.example.com/api/media/file/a%20b.png');
    expect(authorization(settings)).toBe('users API-Key k');
  });

  test('asks for what is live only, whatever the key could read', () => {
    const now = new Date('2026-11-05T10:00:00Z');
    const url = new URL(postsUrl({ url: 'http://cms:3000/', apiKey: 'k', publicUrl: '' }, now));
    expect(url.pathname).toBe('/api/posts');
    expect(url.searchParams.get('where[and][0][_status][equals]')).toBe('published');
    expect(url.searchParams.get('where[and][1][publishedAt][less_than_equal]')).toBe('2026-11-05T10:00:00.000Z');
    expect([url.searchParams.get('locale'), url.searchParams.get('depth'), url.searchParams.get('limit')]).toEqual(['all', '1', '0']);
  });

  test('sends the key and fails on an error answer', async () => {
    const seen: string[] = [];
    const ok = (async (_url: string, init: RequestInit) => {
      seen.push(String((init.headers as Record<string, string>).Authorization));
      return new Response(JSON.stringify({ docs: [CMS_POST] }));
    }) as unknown as typeof fetch;
    expect(await fetchCmsPosts({ url: 'http://cms', apiKey: 'key', publicUrl: '' }, ok)).toHaveLength(1);
    expect(seen).toEqual(['users API-Key key']);
    const denied = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    expect(fetchCmsPosts({ url: 'http://cms', apiKey: 'key', publicUrl: '' }, denied)).rejects.toThrow('403');
  });

  test('forwards a preview link to the CMS, and nothing without all four parts', () => {
    const search = new URLSearchParams({ id: '3', locale: 'de', expires: '1', signature: 'abc', extra: 'x' });
    expect(previewRequestUrl({ url: 'http://cms:3000' }, search)).toBe('http://cms:3000/api/posts/preview?id=3&locale=de&expires=1&signature=abc');
    search.delete('signature');
    expect(previewRequestUrl({ url: 'http://cms:3000' }, search)).toBeUndefined();
  });

  test('the CMS sends the bearer the revalidate route checks, from the same variable names', () => {
    const hook = readFileSync(join(import.meta.dir, '../../../cms/src/hooks/revalidate-website.ts'), 'utf8');
    expect(hook).toContain('WEBSITE_REVALIDATE_TOKEN');
    expect(hook).toContain('Authorization: `Bearer ${settings.token}`');
  });
});

describe('the posts cache', () => {
  test('serves fresh from memory, stale while it refreshes, and the last good copy when the CMS fails', async () => {
    let clock = 0;
    let calls = 0;
    let fail = false;
    const cache = swrCache(async () => {
      calls += 1;
      if (fail) throw new Error('down');
      return calls;
    }, 60, () => clock);
    expect(await cache.get()).toBe(1);
    clock = 30;
    expect(await cache.get()).toBe(1);
    clock = 61;
    expect(await cache.get()).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(await cache.get()).toBe(2);
    fail = true;
    cache.invalidate();
    expect(await cache.get()).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get()).toBe(2);
  });
});

describe('the blog sitemap', () => {
  const post = (locale: 'de' | 'en', slug: string, twin?: string, noindex = false): Post =>
    ({ locale, slug, translationSlug: twin, noindex, pubDate: new Date('2026-08-27T00:00:00Z'), previousSlugs: [] }) as unknown as Post;

  test('pairs twins, lists listings and categories, and leaves out a noindex post', () => {
    const entries = blogEntries({ de: [post('de', 'a', 'b'), post('de', 'hidden', undefined, true)], en: [post('en', 'b', 'a')] });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('/blog/');
    expect(paths).toContain('/en/blog/technology/');
    expect(paths).not.toContain('/blog/hidden/');
    expect(entries.find((e) => e.path === '/blog/a/')?.pair).toEqual({ de: '/blog/a/', en: '/en/blog/b/' });
  });
});
