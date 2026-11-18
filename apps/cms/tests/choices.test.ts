import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { CATEGORIES, COVER_DRAWINGS, CTA_TARGETS } from '../src/fields/choices';
import { CATEGORY_IDS } from '../../website/src/lib/categories';
import { LOCALES, ROUTES, localePath } from '../../website/src/i18n/paths';
import { BLOCK_PARSERS } from '../../website/src/components/blocks/contracts';

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website');

test('the cover drawings are the files in apps/website/src/assets/covers', () => {
  const drawings = readdirSync(path.join(WEBSITE, 'src/assets/covers')).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''));
  expect([...COVER_DRAWINGS].sort()).toEqual(drawings.sort());
});

test("the categories are the website's CATEGORY_IDS", () => {
  expect([...CATEGORIES]).toEqual([...CATEGORY_IDS]);
});

test('every call-to-action target is a route of the website', () => {
  for (const target of CTA_TARGETS) {
    expect(Object.keys(ROUTES), target).toContain(target);
    for (const locale of LOCALES) expect(localePath(target, locale), target).toMatch(/^\//);
  }
});

test("the contracted blocks are the website's BLOCK_PARSERS, one block per contract", async () => {
  const { CONTENT_BLOCKS } = await import('../src/blocks/content-blocks');
  expect(CONTENT_BLOCKS.map((b) => b.slug).sort()).toEqual(Object.keys(BLOCK_PARSERS).sort());
});
