/**
 * From the website's MDX files to CMS records: the German and English twins of
 * a post become one post with both locales, paired by `translationSlug`. Pure
 * functions; `scripts/import-blog.ts` does the reading and the writing.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { withoutIds } from './lexical.mjs';
import { parseMdxPost } from './mdx-post.mjs';

export const LOCALES = ['de', 'en'];

/** Every post file under `contentDir/<locale>/*.mdx`, parsed. */
export function readPosts(contentDir) {
  return LOCALES.flatMap((locale) => {
    const dir = path.join(contentDir, locale);
    return readdirSync(dir)
      .filter((name) => name.endsWith('.mdx'))
      .sort()
      .map((name) => {
        const file = path.join(dir, name);
        return { locale, slug: name.replace(/\.mdx$/, ''), file, ...parseMdxPost(readFileSync(file, 'utf8'), file) };
      });
  });
}

/** `2026-08-27` (a YAML date or string) as the CMS timestamp `2026-08-27T00:00:00.000Z`. */
export function publishTimestamp(value) {
  const date = value instanceof Date ? value : new Date(`${String(value)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`pubDate "${value}" is not a date`);
  return date.toISOString();
}

const SHARED = ['category', 'cover', 'draft'];

/**
 * Groups parsed files into posts. Twins name each other in `translationSlug`;
 * a file whose twin is missing, or does not name it back, is an error, because
 * the language switch and hreflang would point nowhere. A file without
 * `translationSlug` is a post in one language.
 */
export function pairPosts(files) {
  const byKey = new Map(files.map((f) => [`${f.locale}/${f.slug}`, f]));
  const seen = new Set();
  const posts = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const twinSlug = file.frontmatter.translationSlug;
    if (!twinSlug) {
      posts.push([file]);
      continue;
    }
    const other = LOCALES.find((l) => l !== file.locale);
    const twin = byKey.get(`${other}/${twinSlug}`);
    if (!twin) throw new Error(`${file.file}: translationSlug "${twinSlug}" names no ${other} post`);
    if (twin.frontmatter.translationSlug !== file.slug) {
      throw new Error(`${twin.file}: translationSlug should be "${file.slug}", its twin's slug`);
    }
    for (const key of [...SHARED, 'pubDate']) {
      const a = key === 'pubDate' ? publishTimestamp(file.frontmatter.pubDate) : file.frontmatter[key];
      const b = key === 'pubDate' ? publishTimestamp(twin.frontmatter.pubDate) : twin.frontmatter[key];
      if (a !== b) throw new Error(`${file.file} and ${twin.file} disagree on ${key} (${a} / ${b}); the CMS holds it once per post`);
    }
    seen.add(twin);
    posts.push([file, twin].sort((x, y) => LOCALES.indexOf(x.locale) - LOCALES.indexOf(y.locale)));
  }
  return posts;
}

/**
 * One post as the CMS should hold it: what both languages share, and each
 * language's own fields. `status` is Payload's `_status`.
 */
export function toRecord(twins) {
  const { frontmatter } = twins[0];
  return {
    status: frontmatter.draft ? 'draft' : 'published',
    shared: {
      publishedAt: publishTimestamp(frontmatter.pubDate),
      category: frontmatter.category,
      coverType: 'drawing',
      cover: frontmatter.cover,
    },
    locales: Object.fromEntries(
      twins.map((f) => [f.locale, { title: f.frontmatter.title, slug: f.slug, description: f.frontmatter.description, body: f.body }]),
    ),
  };
}

/** A post read with `locale: 'all'` (every localized field an object by locale) in the shape `toRecord` gives. */
export function fromPayload(doc) {
  const locales = {};
  for (const locale of LOCALES) {
    const slug = doc.slug?.[locale];
    if (!slug) continue;
    locales[locale] = { title: doc.title?.[locale], slug, description: doc.description?.[locale], body: doc.body?.[locale] ?? null };
  }
  return {
    status: doc._status,
    shared: { publishedAt: new Date(doc.publishedAt).toISOString(), category: doc.category, coverType: doc.coverType, cover: doc.cover ?? null },
    locales,
  };
}

/** JSON with sorted keys, so two records compare by content. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What the import owns of a record, as one hash: ids an editor's save renumbers are left out. */
export function contentHash(record) {
  return createHash('sha256').update(stableJson(withoutIds(record))).digest('hex');
}
