import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK_PROPS, INLINE_BLOCK_PROPS, blockOf, plainProps } from './post-blocks';
import { headingIds, isLexicalRoot, safeHref, textMarks, type LexicalNode } from './rich-text';

const read = (path: string) => readFileSync(join(import.meta.dir, path), 'utf8');

describe('the rich text a post body holds', () => {
  test('links go only where a page may send a reader', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('/demo/')).toBe('/demo/');
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('mailto:office@example.com')).toBe('mailto:office@example.com');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref(' JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>')).toBeUndefined();
    expect(safeHref('//evil.example/')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  test("text formats become Markdown's elements, bold outermost", () => {
    expect(textMarks(0)).toEqual([]);
    expect(textMarks(1 | 2 | 16)).toEqual(['strong', 'em', 'code']);
    expect(textMarks('x')).toEqual([]);
  });

  test('headings get the ids the MDX pipeline gives them, duplicates numbered', () => {
    const h = (t: string): LexicalNode => ({ type: 'heading', tag: 'h2', children: [{ type: 'text', text: t }] });
    const root: LexicalNode = { type: 'root', children: [h('Was es kann'), h('Was es kann'), h('Büro & Projekt')] };
    expect([...headingIds(root).values()]).toEqual(['was-es-kann', 'was-es-kann-1', 'büro--projekt']);
  });

  test('only Lexical JSON is a body', () => {
    expect(isLexicalRoot({ root: { type: 'root', children: [] } })).toBe(true);
    expect(isLexicalRoot({ root: { type: 'paragraph', children: [] } })).toBe(false);
    expect(isLexicalRoot('<p>html</p>')).toBe(false);
  });
});

describe('the blocks of a post body', () => {
  test('a figure takes its props as the CMS holds them, without Payload’s ids or empty values', () => {
    const fields = { id: 'b1', blockName: '', blockType: 'scopeFigure', alt: 'A', kicker: null, search: 'S', levels: [{ id: 'r1', label: 'X', holds: 'H', visible: 'V' }] };
    expect(blockOf(fields)).toEqual({ slug: 'scopeFigure', props: { alt: 'A', search: 'S', levels: [{ label: 'X', holds: 'H', visible: 'V' }] } });
    expect(plainProps([{ id: 'x', a: null, b: 0 }])).toEqual([{ b: 0 }]);
  });

  test('a block without what its component needs, or of a kind this site does not know, is left out', () => {
    expect(blockOf({ blockType: 'scopeFigure', levels: [] })).toBeUndefined();
    expect(blockOf({ blockType: 'lessonLoopFigure', alt: 'A', labels: { steps: [{}, {}] } })).toBeUndefined();
    expect(blockOf({ blockType: 'image', alt: 'A', image: 12 })).toBeUndefined();
    expect(blockOf({ blockType: 'quote', quote: 'Q' })).toBeUndefined();
    expect(blockOf({ blockType: 'rawHtml', html: '<script>' })).toBeUndefined();
    expect(blockOf({ blockType: 'cta', title: 'T', primary: 'javascript:alert(1)' })).toEqual({
      slug: 'cta', props: { title: 'T', text: undefined, primary: undefined, secondary: undefined },
    });
  });

  test('every block and inline block of the CMS has its props here', () => {
    const cms = read('../../../cms/src/blocks/post-blocks.ts');
    const slugs = [...cms.matchAll(/^\s+slug: '([^']+)',$/gm)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThan(5);
    for (const slug of slugs) expect(slug in BLOCK_PROPS || slug in INLINE_BLOCK_PROPS, slug).toBe(true);
    for (const slug of [...Object.keys(BLOCK_PROPS), ...Object.keys(INLINE_BLOCK_PROPS)]) expect(slugs, slug).toContain(slug);
  });

  test('every block with props is drawn by PostBlock.astro', () => {
    const component = read('../components/PostBlock.astro');
    for (const slug of Object.keys(BLOCK_PROPS)) {
      expect(component.includes(`${slug}: `) || component.includes(`case '${slug}':`), slug).toBe(true);
    }
  });
});
