import { describe, expect, test } from 'bun:test';
import publicSite from '../../../../contracts/public-site.json';
import { LOCALES, ROUTES, type RouteKey } from './paths';
import projectMail from './pages/project-mail';

const SECTION_IDS: Partial<Record<RouteKey, Record<string, string[]>>> = {
  projectMail: Object.fromEntries(LOCALES.map((locale) => [locale, projectMail[locale].sections.map((s) => s.id)])),
};

describe('contracts/public-site.json against the route table', () => {
  test.each(Object.entries(publicSite.paths))('%s is a route at the same paths', (key, paths) => {
    expect(key in ROUTES).toBe(true);
    expect(paths).toEqual({ ...ROUTES[key as RouteKey] });
  });

  test.each(Object.entries(publicSite.anchors))('the anchors on %s are sections in both locales', (key, anchors) => {
    const ids = SECTION_IDS[key as RouteKey];
    expect(ids).toBeDefined();
    for (const locale of LOCALES) {
      for (const anchor of anchors) expect(ids?.[locale]).toContain(anchor);
    }
  });
});

describe('the project mail page', () => {
  test.each(LOCALES)('every heading in %s ends with a full stop or a question mark', (locale) => {
    const headings = [projectMail[locale].heading, ...projectMail[locale].sections.map((s) => s.heading)];
    expect(headings.filter((heading) => !/[.?]$/.test(heading.trim()))).toEqual([]);
  });
});
