/**
 * The blog covers hold to their system (packages/brand/docs/blog-covers.md): each file is a
 * drawing on the 1200 × 800 canvas made only of the shapes and pens the frame styles, with no
 * colour, style, text or id of its own; it has its one solid element; and each post pair has
 * a cover of its own. The schema (src/content.config.ts) already fails a post without one.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COVERS = join(import.meta.dir, '../assets/covers');
const CONTENT = join(import.meta.dir, '../content/blog');

/** The pens and fills of covers.css. A new one is a change to the system, made there first. */
const CLASSES = new Set(['cut', 'view', 'hidden', 'axis', 'dim', 'paper', 'tone', 'hatch', 'solid']);
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'class', 'transform', 'd', 'points', 'fill-rule',
  'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
]);

const covers = readdirSync(COVERS).filter((file) => file.endsWith('.svg'));

function tags(svg: string) {
  return [...svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([a-zA-Z][\w-]*)([^>]*?)\/?>/g)].map(([, name, rest]) => ({
    name,
    attributes: [...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => ({ key, value })),
  }));
}

/** `name` and `cover` of every post, read from its frontmatter. */
function posts() {
  return ['de', 'en'].flatMap((locale) =>
    readdirSync(join(CONTENT, locale)).filter((file) => file.endsWith('.mdx')).map((file) => {
      const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(CONTENT, locale, file), 'utf8'))?.[1] ?? '';
      const field = (name: string) => new RegExp(`^${name}:\\s*'?([^'\\n]+?)'?\\s*$`, 'm').exec(head)?.[1];
      return { locale, slug: file.replace(/\.mdx$/, ''), cover: field('cover'), translationSlug: field('translationSlug') };
    }),
  );
}

describe('blog covers', () => {
  test('there are covers', () => {
    expect(covers.length).toBeGreaterThan(0);
  });

  for (const file of covers) {
    describe(file, () => {
      const svg = readFileSync(join(COVERS, file), 'utf8');
      const all = tags(svg);

      test('is kebab-case English and one <svg> on the 1200 × 800 canvas', () => {
        expect(file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.svg$/);
        expect(all[0]?.name).toBe('svg');
        expect(all[0]?.attributes.find((a) => a.key === 'viewBox')?.value).toBe('0 0 1200 800');
      });

      test('uses only the shapes, attributes and pens of the system', () => {
        for (const tag of all) {
          expect({ tag: tag.name, allowed: ELEMENTS.has(tag.name) }).toEqual({ tag: tag.name, allowed: true });
          for (const { key, value } of tag.attributes) {
            expect({ tag: tag.name, key, allowed: ATTRIBUTES.has(key) }).toEqual({ tag: tag.name, key, allowed: true });
            if (key !== 'class') continue;
            for (const name of value.split(/\s+/)) expect({ class: name, allowed: CLASSES.has(name) }).toEqual({ class: name, allowed: true });
          }
        }
      });

      test('has its solid element: what the cover is about', () => {
        const solids = all.filter((tag) => tag.attributes.some((a) => a.key === 'class' && a.value.split(/\s+/).includes('solid')));
        expect(solids.length).toBeGreaterThan(0);
      });
    });
  }

  test('every post names a cover that exists, and only its translation shares it', () => {
    const all = posts();
    const ids = new Set(covers.map((file) => file.replace(/\.svg$/, '')));
    for (const post of all) {
      expect({ post: post.slug, cover: post.cover, exists: ids.has(post.cover ?? '') }).toEqual({ post: post.slug, cover: post.cover, exists: true });
      const sharing = all.filter((other) => other !== post && other.cover === post.cover);
      for (const other of sharing) {
        const twins = other.locale !== post.locale && post.translationSlug === other.slug;
        expect({ post: post.slug, shares: other.slug, twins }).toEqual({ post: post.slug, shares: other.slug, twins: true });
      }
    }
  });

  test('every cover belongs to a post', () => {
    const used = new Set(posts().map((post) => post.cover));
    for (const file of covers) expect({ file, used: used.has(file.replace(/\.svg$/, '')) }).toEqual({ file, used: true });
  });
});
