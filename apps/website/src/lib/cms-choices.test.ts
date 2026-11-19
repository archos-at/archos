import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_BLOCKS } from '../../../cms/src/blocks/content-blocks';
import { CATEGORIES, COVER_DRAWINGS, CTA_TARGETS } from '../../../cms/src/fields/choices';
import { BLOCK_PARSERS } from '../components/blocks/contracts';
import { ROUTES } from '../i18n/paths';
import { CATEGORY_IDS } from './categories';

const COVERS = join(import.meta.dir, '../assets/covers');

describe("the CMS's choices are the website's", () => {
  test('the cover drawings are the drawings in src/assets/covers', () => {
    const drawings = readdirSync(COVERS)
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.slice(0, -'.svg'.length));
    expect([...COVER_DRAWINGS].sort()).toEqual(drawings.sort());
  });

  test('the categories are CATEGORY_IDS, in order', () => {
    expect([...CATEGORIES]).toEqual([...CATEGORY_IDS]);
  });

  test('every call-to-action target is a route', () => {
    for (const target of CTA_TARGETS) expect(Object.keys(ROUTES), target).toContain(target);
  });

  test('the contracted blocks are BLOCK_PARSERS, one block per contract', () => {
    expect(CONTENT_BLOCKS.map((block) => block.slug).sort()).toEqual(Object.keys(BLOCK_PARSERS).sort());
  });
});
