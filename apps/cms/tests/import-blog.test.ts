/**
 * The MDX posts convert to what the CMS holds: Lexical rich text whose figures
 * are the typed blocks of the same components, both languages in one record.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { contentHash, pairPosts, readPosts, toRecord } from '../scripts/lib/blog-posts.mjs';
import { FORMAT } from '../scripts/lib/lexical.mjs';
import { FIGURE_BLOCKS, literalValue, parseMdxPost } from '../scripts/lib/mdx-post.mjs';
import { FIGURE_BLOCKS as CMS_FIGURES, POST_BLOCKS } from '../src/blocks/post-blocks';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(HERE, '../../website/src/content/blog');

type Node = { type: string; children?: Node[]; text?: string; format?: number; tag?: string; fields?: Record<string, unknown> };
const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
};

test('every post of the website converts, and its twins pair', () => {
  const posts = pairPosts(readPosts(CONTENT));
  assert.ok(posts.length > 0);
  for (const twins of posts) {
    const record = toRecord(twins);
    assert.ok(['draft', 'published'].includes(record.status));
    // Twins carry the same figures in the same order: an editor sees them side by side.
    const figures = Object.values(record.locales).map((l) => {
      const kinds: string[] = [];
      walk(l.body.root, (n) => n.type === 'block' && kinds.push(String(n.fields?.blockType)));
      return kinds.join(',');
    });
    assert.equal(new Set(figures).size, 1, `${twins[0].slug}: the twins' figures differ`);
  }
});

test("a converted body keeps every word of the source's text and every figure", () => {
  for (const file of readPosts(CONTENT)) {
    const raw = readFileSync(file.file, 'utf8');
    const source = raw.replace(/\\([^\w\s])/g, '$1').replace(/\s+/g, ' ');
    const texts: string[] = [];
    let figures = 0;
    walk(file.body.root as Node, (n) => {
      if (n.type === 'text') texts.push(n.text ?? '');
      if (n.type === 'block') figures += 1;
    });
    for (const t of texts) assert.ok(source.includes(t.replace(/\s+/g, ' ').trim()), `${file.file}: "${t}" is not in the source`);
    assert.equal(figures, (raw.match(/^<[A-Z]\w*Figure\b/gm) ?? []).length, file.file);
  }
});

test("Markdown becomes the editor's own nodes, formats and nesting kept", () => {
  const source = ['---', 'title: T', '---', '', '## Head *it*', '', 'A **b** `c` [d](https://e.example/) ~~f~~', '', '- one', '  - nested', '', '> q', '', '| x |', '|---|', '| y |', ''].join('\n');
  const { body } = parseMdxPost(source, 'p.mdx');
  const [heading, para, list, quote, table] = body.root.children as Node[];
  assert.equal(heading.tag, 'h2');
  assert.deepEqual(para.children!.map((n) => [n.type, n.format ?? null]), [
    ['text', 0], ['text', FORMAT.bold], ['text', 0], ['text', FORMAT.code], ['text', 0], ['link', ''], ['text', 0], ['text', FORMAT.strikethrough],
  ]);
  // A nested list is the only child of a list item of its own, as Lexical keeps it.
  assert.deepEqual(list.children!.map((item) => item.children![0].type), ['text', 'list']);
  assert.equal(quote.type, 'quote');
  assert.deepEqual(table.children!.map((row) => row.type), ['tablerow', 'tablerow']);
});

test('a figure becomes the typed block of its component, with its props as fields', () => {
  const source = [
    '---', 'title: T', '---', '',
    "import ScopeFigure from '../../../components/figures/ScopeFigure.astro'", '',
    'Before.', '',
    '<ScopeFigure alt="A" levels={[{ label: \'X\', holds: \'H\', visible: \'V\' }]} search={`S`} />', '',
    'After.', '',
  ].join('\n');
  const { body } = parseMdxPost(source, 'post.mdx');
  const [, figure] = body.root.children as Node[];
  assert.equal(figure.type, 'block');
  const { id, ...fields } = figure.fields!;
  assert.match(String(id), /^[0-9a-f]{24}$/);
  assert.deepEqual(fields, { blockName: '', blockType: 'scopeFigure', alt: 'A', levels: [{ label: 'X', holds: 'H', visible: 'V' }], search: 'S' });
});

test("every figure the posts may import is a block of the CMS, with a field for each prop", () => {
  const slugs = POST_BLOCKS.map((b) => b.slug);
  for (const blockType of Object.values(FIGURE_BLOCKS)) assert.ok(slugs.includes(blockType), blockType);
  assert.deepEqual(CMS_FIGURES.map((b) => b.slug).sort(), Object.values(FIGURE_BLOCKS).sort());
  for (const file of readPosts(CONTENT)) {
    walk(file.body.root as Node, (n) => {
      if (n.type !== 'block') return;
      const block = POST_BLOCKS.find((b) => b.slug === n.fields!.blockType)!;
      const names = block.fields.map((f) => ('name' in f ? f.name : ''));
      for (const prop of Object.keys(n.fields!).filter((k) => !['id', 'blockName', 'blockType'].includes(k))) {
        assert.ok(names.includes(prop), `${file.file}: ${block.slug} has no field ${prop}`);
      }
    });
  }
});

test('MDX the CMS cannot hold fails with its line', () => {
  const header = '---\ntitle: T\n---\n\n';
  assert.throws(() => parseMdxPost(`${header}import x from 'y'\n`, 'p.mdx'), /only figure imports/);
  assert.throws(() => parseMdxPost(`${header}Text {1 + 1}\n`, 'p.mdx'), /mdxTextExpression/);
  assert.throws(() => parseMdxPost(`${header}<Other />\n`, 'p.mdx'), /not an imported figure/);
  assert.throws(() => parseMdxPost(`${header}<div>raw</div>\n`, 'p.mdx'), /not an imported figure|has no form/);
  assert.throws(() => parseMdxPost(`${header}# Second title\n`, 'p.mdx'), /only h1/);
  assert.throws(() => literalValue({ type: 'Identifier', name: 'x' }, 'here'), /not a literal/);
});

test('twins that disagree on what the CMS holds once are refused', () => {
  const twin = (locale: string, slug: string, other: string, category: string) => ({
    locale, slug, file: `${locale}/${slug}.mdx`, body: { root: {} },
    frontmatter: { title: slug, description: 'd', pubDate: '2026-01-01', category, cover: 'welcome', translationSlug: other },
  });
  assert.throws(() => pairPosts([twin('de', 'a', 'b', 'product'), twin('en', 'b', 'a', 'practice')]), /disagree on category/);
  assert.throws(() => pairPosts([twin('de', 'a', 'missing', 'product')]), /names no en post/);
});

test("the content hash ignores ids an editor's save renumbers, and nothing else", () => {
  const record = toRecord(pairPosts(readPosts(CONTENT))[0]);
  const renumbered = JSON.parse(JSON.stringify(record).replace(/"id":"[0-9a-f]{24}"/g, '"id":"0"'));
  assert.equal(contentHash(renumbered), contentHash(record));
  assert.notEqual(contentHash({ ...record, status: 'draft' }), contentHash({ ...record, status: 'published' }));
});
