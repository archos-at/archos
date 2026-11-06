/**
 * A blog post as the views render it, whichever source it came from: the CMS
 * (Payload, apps/cms, ADR-0155) or the MDX fixtures in src/content/blog that the
 * site falls back to without one. Pure: `fromCms` maps the CMS's JSON (a post
 * read with `locale=all`, every localized field an object by locale).
 */
import type { CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n/paths';
import { CATEGORY_IDS, type Category } from './categories';
import type { ImageSize } from './cms';
import { isLexicalRoot, type LexicalNode } from './rich-text';

/** An uploaded image as the CMS serves it (apps/cms/src/collections/media.ts), populated by `depth=1`. */
export interface MediaFile {
  url: string;
  alt?: string | null;
  aiGenerated?: boolean | null;
  width?: number | null;
  height?: number | null;
  sizes?: Partial<Record<ImageSize, { url?: string | null; width?: number | null; height?: number | null } | null>> | null;
}

export type Cover = { kind: 'drawing'; id: string } | { kind: 'image'; file: MediaFile; alt: string; aiGenerated: boolean };

export type PostBody = { kind: 'mdx'; entry: CollectionEntry<'blog'> } | { kind: 'rich-text'; root: LexicalNode };

export interface Post {
  locale: Locale;
  slug: string;
  /** For <title>, JSON-LD and the feed: soft hyphens removed. */
  title: string;
  /** For the page's heading: soft hyphens (U+00AD) kept, so a long compound breaks where the author said. */
  heading: string;
  description: string;
  pubDate: Date;
  /** The last change, for the sitemap's lastmod and JSON-LD's dateModified. */
  updated?: Date;
  category: Category;
  cover: Cover;
  /** The other locale's slug, when the post has a twin. */
  translationSlug?: string;
  seoTitle?: string;
  seoDescription?: string;
  noindex: boolean;
  /** Slugs this post had before; each answers with a 301 to the current one. */
  previousSlugs: string[];
  author?: { name: string; jobTitle?: string; url?: string };
  body: PostBody;
}

const SOFT_HYPHEN = /\u00AD/g;

/** A localized field read with `locale=all`. */
type Localized<T> = Partial<Record<Locale, T | null>> | null | undefined;

/* The CMS's JSON, as cms.ts reads it. Loose on purpose: it crosses a network. */
export interface CmsPost {
  id: number | string;
  publishedAt: string;
  updatedAt?: string | null;
  category: string;
  coverType?: string | null;
  cover?: string | null;
  coverImage?: MediaFile | number | null;
  coverAlt?: Localized<string>;
  author?: { name: string; jobTitle?: Localized<string>; profileUrl?: string | null } | number | null;
  title: Localized<string>;
  slug: Localized<string>;
  description: Localized<string>;
  seo?: { title?: Localized<string>; description?: Localized<string>; noindex?: Localized<boolean> } | null;
  previousSlugs?: Localized<string[]>;
  body?: Localized<unknown>;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const media = (value: unknown): MediaFile | undefined =>
  value && typeof value === 'object' && typeof (value as MediaFile).url === 'string' ? (value as MediaFile) : undefined;

function coverFromCms(post: CmsPost, locale: Locale): Cover | undefined {
  if (post.coverType === 'image') {
    const file = media(post.coverImage);
    const alt = text(post.coverAlt?.[locale]);
    return file && alt ? { kind: 'image', file, alt, aiGenerated: file.aiGenerated === true } : undefined;
  }
  return post.cover ? { kind: 'drawing', id: post.cover } : undefined;
}

/**
 * The post in `locale`, or undefined when it has no such version or holds
 * something this site cannot show (an unknown category, no cover, no body).
 */
export function fromCms(post: CmsPost, locale: Locale): Post | undefined {
  const slug = text(post.slug?.[locale]);
  const title = text(post.title?.[locale]);
  const description = text(post.description?.[locale]);
  const body = post.body?.[locale];
  const category = post.category as Category;
  const cover = coverFromCms(post, locale);
  if (!slug || !title || !description || !isLexicalRoot(body) || !CATEGORY_IDS.includes(category) || !cover) return undefined;
  const other: Locale = locale === 'de' ? 'en' : 'de';
  const twin = text(post.slug?.[other]) && text(post.title?.[other]) ? post.slug?.[other] ?? undefined : undefined;
  const author = typeof post.author === 'object' && post.author?.name ? post.author : undefined;
  return {
    locale,
    slug,
    title: title.replace(SOFT_HYPHEN, ''),
    heading: title,
    description,
    pubDate: new Date(post.publishedAt),
    updated: post.updatedAt ? new Date(post.updatedAt) : undefined,
    category,
    cover,
    translationSlug: twin,
    seoTitle: text(post.seo?.title?.[locale]),
    seoDescription: text(post.seo?.description?.[locale]),
    noindex: post.seo?.noindex?.[locale] === true,
    previousSlugs: (post.previousSlugs?.[locale] ?? []).filter((s): s is string => typeof s === 'string'),
    author: author ? { name: author.name, jobTitle: text(author.jobTitle?.[locale]), url: text(author.profileUrl) } : undefined,
    body: { kind: 'rich-text', root: body.root },
  };
}

/** A fixture post (src/content/blog/<locale>/<slug>.mdx) in the same shape. */
export function fromFixture(entry: CollectionEntry<'blog'>): Post {
  const { data } = entry;
  return {
    locale: entry.id.slice(0, 2) as Locale,
    slug: entry.id.slice(3),
    title: data.title,
    heading: data.heading,
    description: data.description,
    pubDate: data.pubDate,
    category: data.category,
    cover: { kind: 'drawing', id: data.cover },
    translationSlug: data.translationSlug,
    noindex: false,
    previousSlugs: [],
    body: { kind: 'mdx', entry },
  };
}
