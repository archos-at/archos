/**
 * The unlisted pages (UNLISTED_ROUTES in src/i18n/paths.ts) are built and answer at their
 * address, but nothing on the site offers them: no navigation or footer link, no link from
 * a page, a post or llms.txt, no sitemap entry. BaseLayout marks them noindex; the sitemap
 * filter leaves them out. This holds the links.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sitemapFilter } from '../../sitemap.mjs';
import { navigation } from '../i18n/nav';
import { LOCALES, ROUTES, UNLISTED_ROUTES, isUnlisted } from '../i18n/paths';

const SRC = join(import.meta.dir, '..');

/** The unlisted pages' own views, and the route table: they may name them. */
const OWN_FILES = new Set([
  'views/FirmsView.astro',
  'views/BuildingLawView.astro',
  'views/RevisionsView.astro',
  'views/BlogBlocksView.astro',
  'i18n/pages/blog-blocks.ts',
  'i18n/paths.ts',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(astro|ts|mdx|md)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('unlisted pages', () => {
  test('the navigation and the footer do not link them', () => {
    for (const locale of LOCALES) {
      const nav = navigation(locale);
      const hrefs = [...nav.mainNav, ...nav.footerColumns.flatMap((c) => c.links), ...nav.legal].map((l) => l.href);
      expect(hrefs.filter(isUnlisted)).toEqual([]);
    }
  });

  test('no page, post or copy names their path or route key', () => {
    const paths = UNLISTED_ROUTES.flatMap((key) => [ROUTES[key].de, ROUTES[key].en]);
    const keys = UNLISTED_ROUTES.map((key) => `localePath('${key}'`);
    const keyRefs = UNLISTED_ROUTES.map((key) => `ROUTES.${key}`);
    const hits: string[] = [];
    for (const file of files(SRC)) {
      const name = relative(SRC, file);
      if (OWN_FILES.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      for (const needle of [...keys, ...keyRefs]) if (text.includes(needle)) hits.push(`${name}: ${needle}`);
      for (const path of paths) if (new RegExp(`["'(=]${path}`).test(text)) hits.push(`${name}: ${path}`);
    }
    expect(hits).toEqual([]);
  });

  test('the sitemap leaves them out and keeps the listed pages', () => {
    const site = 'https://example.org';
    for (const key of UNLISTED_ROUTES) {
      expect(sitemapFilter(`${site}${ROUTES[key].de}`)).toBe(false);
      expect(sitemapFilter(`${site}${ROUTES[key].en}`)).toBe(false);
    }
    expect(sitemapFilter(`${site}${ROUTES.security.de}`)).toBe(true);
    expect(sitemapFilter(`${site}${ROUTES.home.en}`)).toBe(true);
  });
});
