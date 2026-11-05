import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { comparable, pairPosts, readPosts, stableJson, toRecord, updateBody } from './lib/blog-posts.mjs';
import { literalValue, parseMdxPost } from './lib/mdx-post.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(HERE, '../../website/src/content/blog');

test('every post of the website converts, and its twins pair', () => {
  const files = readPosts(CONTENT);
  const posts = pairPosts(files);
  assert.ok(posts.length > 0);
  for (const twins of posts) {
    const record = toRecord(twins);
    assert.ok(['draft', 'published'].includes(record.status));
    // Twins share their figures in the same order: the CMS shows them side by side.
    const shapes = record.translations.map((t) => t.blocks.map((b) => b.item.component ?? b.collection).join(','));
    assert.equal(new Set(shapes).size, 1, `${twins[0].slug}: the twins' block sequences differ`);
  }
});

test('a converted body keeps every line of the source and nothing of MDX', () => {
  for (const file of readPosts(CONTENT)) {
    const source = readFileSync(file.file, 'utf8');
    const markdown = file.blocks.filter((b) => b.collection === 'block_markdown').map((b) => b.item.text);
    for (const text of markdown) {
      assert.ok(!/^import\s/m.test(text), `${file.file}: an import line survived`);
      assert.ok(!/<[A-Z]/.test(text), `${file.file}: a component survived`);
      for (const line of text.split('\n').filter(Boolean)) assert.ok(source.includes(line), `${file.file}: "${line}" is not in the source`);
    }
    const components = (source.match(/^<[A-Z]\w*Figure\b/gm) ?? []).length;
    assert.equal(file.blocks.filter((b) => b.collection === 'block_figure').length, components, file.file);
  }
});

test('a figure becomes a block between the Markdown around it, with its props as JSON', () => {
  const source = [
    '---', 'title: T', 'description: D', 'pubDate: 2026-01-02', 'category: product', 'cover: welcome', '---', '',
    "import ScopeFigure from '../../../components/figures/ScopeFigure.astro'", '',
    'Before.', '',
    '<ScopeFigure alt="A" levels={[{ label: \'X\', n: -1 }]} search={`S`} framed />', '',
    'After.', '',
  ].join('\n');
  const { frontmatter, blocks } = parseMdxPost(source, 'post.mdx');
  assert.equal(frontmatter.pubDate, '2026-01-02');
  assert.deepEqual(blocks, [
    { collection: 'block_markdown', item: { text: 'Before.\n' } },
    { collection: 'block_figure', item: { component: 'scope', props: { alt: 'A', levels: [{ label: 'X', n: -1 }], search: 'S', framed: true } } },
    { collection: 'block_markdown', item: { text: 'After.\n' } },
  ]);
});

test('MDX the CMS cannot hold fails with its line', () => {
  const header = '---\ntitle: T\n---\n\n';
  assert.throws(() => parseMdxPost(`${header}import x from 'y'\n`, 'p.mdx'), /only figure imports/);
  assert.throws(() => parseMdxPost(`${header}Text {1 + 1}\n`, 'p.mdx'), /mdxTextExpression/);
  assert.throws(() => parseMdxPost(`${header}<Other />\n`, 'p.mdx'), /not an imported figure/);
  assert.throws(() => literalValue({ type: 'Identifier', name: 'x' }, 'here'), /not a literal/);
});

test('twins that disagree on what the CMS holds once are refused', () => {
  const twin = (locale, slug, other, category) => ({
    locale, slug, file: `${locale}/${slug}.mdx`, blocks: [],
    frontmatter: { title: slug, description: 'd', pubDate: '2026-01-01', category, cover: 'welcome', translationSlug: other },
  });
  assert.throws(() => pairPosts([twin('de', 'a', 'b', 'product'), twin('en', 'b', 'a', 'practice')]), /disagree on category/);
  assert.throws(() => pairPosts([twin('de', 'a', 'missing', 'product')]), /names no en post/);
});

test('an update keeps the ids of what it reuses and compares equal afterwards', () => {
  const desired = toRecord(pairPosts(readPosts(CONTENT))[0]);
  const current = {
    ...desired,
    cover: 'other',
    translations: desired.translations.map((t, ti) => ({
      ...t,
      id: 10 + ti,
      blocks: t.blocks.map((b, bi) => ({ id: 100 * (ti + 1) + bi, collection: b.collection, item: { id: 1000 + bi, ...b.item } })),
    })),
  };
  assert.notEqual(stableJson(comparable(current)), stableJson(comparable(desired)));
  const body = updateBody(current, desired);
  assert.equal(body.cover, desired.cover);
  assert.equal(body.translations[0].id, 10);
  assert.equal(body.translations[0].blocks[0].id, 100);
  assert.equal(body.translations[0].blocks[0].item.id, 1000);
  assert.equal(stableJson(comparable(body)), stableJson(comparable(desired)));
});
