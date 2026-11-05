/**
 * The values the CMS offers that the website owns in code (src/fields/choices.ts):
 * a cover drawing, a category, a figure or a call-to-action target the website
 * does not know would publish a post it cannot draw.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { CATEGORIES, COVER_DRAWINGS, CTA_TARGETS } from '../src/fields/choices';

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website');
const source = (file: string) => readFileSync(path.join(WEBSITE, file), 'utf8');

test('the cover drawings are the files in apps/website/src/assets/covers', () => {
  const drawings = readdirSync(path.join(WEBSITE, 'src/assets/covers')).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''));
  expect([...COVER_DRAWINGS].sort()).toEqual(drawings.sort());
});

test('the categories are CATEGORY_IDS of apps/website/src/lib/categories.ts', () => {
  const ids = /CATEGORY_IDS\s*=\s*\[([^\]]*)\]/.exec(source('src/lib/categories.ts'))![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1));
  expect([...CATEGORIES]).toEqual(ids);
});

test('every call-to-action target is a route of the website', () => {
  const paths = source('src/i18n/paths.ts');
  for (const target of CTA_TARGETS) expect(paths, target).toMatch(new RegExp(`\\b${target}:\\s*\\{`));
});

test("the contracted blocks are the website's BLOCK_PARSERS, one block per contract", async () => {
  const { CONTENT_BLOCKS } = await import('../src/blocks/content-blocks');
  const contracts = source('src/components/blocks/contracts.ts');
  const parsers = /export const BLOCK_PARSERS = \{([^}]*)\}/.exec(contracts)![1].match(/^\s*(\w+):/gm)!.map((k) => k.trim().replace(':', ''));
  expect(CONTENT_BLOCKS.map((b) => b.slug).sort()).toEqual(parsers.sort());
});
