import { expect, test } from 'vitest';
import { CONTENT_BLOCKS } from '../src/blocks/content-blocks';
import { CtaBlock } from '../src/blocks/post-blocks';
import { CTA_TARGETS, options } from '../src/fields/choices';

test('a choice is offered under its own value, in the order of its list', () => {
  expect(options(['demo', 'contact'])).toEqual([
    { label: 'demo', value: 'demo' },
    { label: 'contact', value: 'contact' },
  ]);
});

test('both call-to-action selects offer exactly the call-to-action targets', () => {
  const selects = CtaBlock.fields.filter((field) => field.type === 'select');
  expect(selects.map((field) => field.name)).toEqual(['primary', 'secondary']);
  for (const select of selects) expect(select.options).toEqual(options(CTA_TARGETS));
});

test('every contracted block has a slug of its own', () => {
  const slugs = CONTENT_BLOCKS.map((block) => block.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});
