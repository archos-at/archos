import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blogEntries } from './blog-sitemap';
import { assetUrl, cmsSettings, fetchCmsPosts, POST_FIELDS, postsUrl, swrCache } from './cms';
import { markdownToHtml } from './markdown';
import { blockFromCms, fromCms, type CmsPost, type Post } from './post-model';

/** A post as the CMS answers `postsUrl` (shape read from Directus 12.6.1 on 2026-11-05). */
const CMS_POST: CmsPost = {
  id: '3d72c481',
  publish_date: '2026-08-27T00:00:00.000Z',
  date_updated: '2026-09-01T10:00:00.000Z',
  category: 'technology',
  cover_type: 'drawing',
  cover: 'answer-pipeline',
  cover_image: null,
  cover_alt: null,
  cover_ai_generated: false,
  author: { name: 'Anna Muster', job_title: 'Architektin', profile_url: null },
  translations: [
    {
      languages_code: 'de',
      title: 'Wie das Arbeits­buch funktioniert',
      slug: 'so-arbeitet-der-workspace',
      description: 'Ein Rundgang.',
      seo_title: null,
      seo_description: '',
      noindex: false,
      previous_slugs: ['alter-slug'],
      blocks: [
        { collection: 'block_markdown', item: { text: 'Absatz.\n' } },
        { collection: 'block_figure', item: { component: 'iso_stack', props: { alt: 'Stapel', layers: [] } } },
        { collection: 'block_gallery', item: { images: [] } },
      ],
    },
    { languages_code: 'en', title: 'How it works', slug: 'how-the-workspace-works', description: 'A tour.', blocks: [] },
  ],
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
    // A block kind this site does not know yet is left out, never rendered half.
    expect(de.body).toEqual({
      kind: 'blocks',
      blocks: [
        { kind: 'markdown', text: 'Absatz.\n' },
        { kind: 'figure', component: 'iso_stack', props: { alt: 'Stapel', layers: [] } },
      ],
    });
  });

  test('is left out where the site cannot show it', () => {
    expect(fromCms({ ...CMS_POST, translations: [CMS_POST.translations[0]] }, 'en')).toBeUndefined();
    expect(fromCms({ ...CMS_POST, category: 'news' }, 'de')).toBeUndefined();
    expect(fromCms({ ...CMS_POST, cover_type: 'image', cover_image: 'f1', cover_alt: null }, 'de')).toBeUndefined();
    const image = fromCms({ ...CMS_POST, cover_type: 'image', cover_image: 'f1', cover_alt: 'Ein Plan', cover_ai_generated: true }, 'de');
    expect(image?.cover).toEqual({ kind: 'image', file: 'f1', alt: 'Ein Plan', aiGenerated: true });
  });

  test('blocks without what their component needs are dropped', () => {
    expect(blockFromCms({ collection: 'block_image', item: { image: 'f1' } })).toBeUndefined();
    expect(blockFromCms({ collection: 'block_quote', item: { quote: 'Q' } })).toBeUndefined();
    expect(blockFromCms({ collection: 'block_figure', item: { component: 'pie', props: {} } })).toBeUndefined();
    expect(blockFromCms({ collection: 'block_cta', item: { title: 'T', primary: 'demo' } })).toEqual({
      kind: 'cta', title: 'T', text: undefined, primary: 'demo', secondary: undefined,
    });
  });
});

describe('the CMS client', () => {
  test('reads only with a URL and a token, and serves assets from the public URL', () => {
    expect(cmsSettings({})).toBeUndefined();
    expect(cmsSettings({ CMS_URL: 'http://cms:8055' })).toBeUndefined();
    const settings = cmsSettings({ CMS_URL: 'http://cms:8055', CMS_TOKEN: 't', CMS_PUBLIC_URL: 'https://cms.example.com' })!;
    expect(assetUrl(settings, 'f 1', 'share')).toBe('https://cms.example.com/assets/f%201?key=share');
  });

  test('asks for what is live only, whatever the token could read', () => {
    const url = new URL(postsUrl({ url: 'http://cms:8055/', token: 't', publicUrl: '' }));
    expect(url.pathname).toBe('/items/blog_posts');
    expect(JSON.parse(url.searchParams.get('filter')!)).toEqual({ _and: [{ status: { _eq: 'published' } }, { publish_date: { _lte: '$NOW' } }] });
    expect(url.searchParams.get('fields')!.split(',')).toEqual(POST_FIELDS);
  });

  test('reads every block field the CMS schema defines', () => {
    const schema = join(import.meta.dir, '../../../cms/directus/default/schema');
    for (const file of readdirSync(schema).filter((f) => f.startsWith('block-'))) {
      const { collection, fields } = JSON.parse(readFileSync(join(schema, file), 'utf8'));
      for (const { field } of fields.filter((f: { field: string }) => f.field !== 'id')) {
        expect(POST_FIELDS).toContain(`translations.blocks.item:${collection}.${field}`);
      }
    }
  });

  test('sends the token and fails on an error answer', async () => {
    const seen: string[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push(String((init.headers as Record<string, string>).Authorization));
      return new Response(JSON.stringify({ data: [CMS_POST] }));
    }) as unknown as typeof fetch;
    expect(await fetchCmsPosts({ url: 'http://cms', token: 'tok', publicUrl: '' }, ok)).toHaveLength(1);
    expect(seen).toEqual(['Bearer tok']);
    const denied = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    expect(fetchCmsPosts({ url: 'http://cms', token: 'tok', publicUrl: '' }, denied)).rejects.toThrow('403');
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

describe('a Markdown block', () => {
  test('renders tables and links, and escapes raw HTML', () => {
    const html = markdownToHtml('| a |\n|---|\n| b |\n\n[Demo](/demo/) <script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).toContain('<table>');
    expect(html).toContain('<a href="/demo/">Demo</a>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
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
