import { parse } from '@astrojs/compiler-rs';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST_BLOCKS, POST_INLINE_BLOCKS } from '../../../cms/src/blocks/post-blocks';
import { BLOCK_PROPS, INLINE_BLOCK_PROPS, blockOf, plainProps } from './post-blocks';
import { headingIds, hoistLinkMarks, isLexicalRoot, safeHref, textMarks, type LexicalNode } from './rich-text';

type AstNode = { type?: string; [key: string]: unknown };

function nodesOf(root: unknown, type: string): AstNode[] {
  if (Array.isArray(root)) return root.flatMap((child) => nodesOf(child, type));
  if (!root || typeof root !== 'object') return [];
  const node = root as AstNode;
  return [...(node.type === type ? [node] : []), ...Object.values(node).flatMap((child) => nodesOf(child, type))];
}

function drawnSlugs(path: string): Set<string> {
  const { ast, diagnostics } = parse(readFileSync(join(import.meta.dir, path), 'utf8'));
  expect(diagnostics).toEqual([]);
  const figures = nodesOf(ast.frontmatter, 'VariableDeclarator').find((d) => (d.id as AstNode).name === 'FIGURES');
  const keys = nodesOf(figures?.init, 'Property').map((p) => (p.key as AstNode).name ?? (p.key as AstNode).value);
  const cases = nodesOf(ast.body, 'SwitchCase').map((c) => (c.test as AstNode | null)?.value);
  return new Set([...keys, ...cases].filter((slug): slug is string => typeof slug === 'string'));
}

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

  test("a link's shared marks go outside it, as Markdown nests them", () => {
    const link: LexicalNode = { type: 'link', children: [{ type: 'text', text: 'a', format: 1 | 2 }, { type: 'text', text: 'b', format: 1 }] };
    expect(hoistLinkMarks(link)).toEqual({ outer: ['strong'], children: [{ type: 'text', text: 'a', format: 2 }, { type: 'text', text: 'b', format: 0 }] });
    expect(hoistLinkMarks({ type: 'link', children: [{ type: 'text', text: 'a', format: 0 }] }).outer).toEqual([]);
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
    const slugs = [...POST_BLOCKS, ...POST_INLINE_BLOCKS].map((block) => block.slug);
    expect(slugs.length).toBeGreaterThan(5);
    for (const slug of slugs) expect(slug in BLOCK_PROPS || slug in INLINE_BLOCK_PROPS, slug).toBe(true);
    for (const slug of [...Object.keys(BLOCK_PROPS), ...Object.keys(INLINE_BLOCK_PROPS)]) expect(slugs, slug).toContain(slug);
  });

  test('a contracted block is parsed by its contract, its uploads turned into images first', () => {
    const file = { url: '/api/media/file/plan.webp', width: 2400, height: 1500 };
    const fields = { blockType: 'compare', id: 'x', before: file, beforeAlt: 'Rev. C', after: file, afterAlt: 'Rev. D', beforeLabel: 'C', afterLabel: 'D', caption: null, start: null };
    expect(blockOf(fields)).toEqual({
      slug: 'compare',
      props: {
        before: { src: '/api/media/file/plan.webp', width: 2400, height: 1500, alt: 'Rev. C' },
        after: { src: '/api/media/file/plan.webp', width: 2400, height: 1500, alt: 'Rev. D' },
        beforeLabel: 'C',
        afterLabel: 'D',
      },
    });
    expect(blockOf({ ...fields, afterAlt: null })).toBeUndefined();
    const chart = blockOf({ blockType: 'chart', form: 'bar', title: 'T', source: 'S', table: 'Phase; A\nVorentwurf; 4\nEntwurf; 6', startAtZero: null });
    expect(chart?.slug).toBe('chart');
    expect(blockOf({ blockType: 'keyTakeaways', items: [{ id: '1', text: 'Eins.' }] })).toBeUndefined();
  });

  test('every block with props is drawn by PostBlock.astro', () => {
    const drawn = drawnSlugs('../components/PostBlock.astro');
    expect(drawn.size).toBeGreaterThan(5);
    for (const slug of Object.keys(BLOCK_PROPS)) expect(drawn.has(slug), slug).toBe(true);
  });
});
