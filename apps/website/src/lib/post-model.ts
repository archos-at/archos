import type { CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n/paths';
import { CATEGORY_IDS, type Category } from './categories';
import type { ImageSize } from './cms';
import { isLexicalRoot, type LexicalNode } from './rich-text';

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
  title: string;
  heading: string;
  description: string;
  pubDate: Date;
  updated?: Date;
  category: Category;
  cover: Cover;
  translationSlug?: string;
  seoTitle?: string;
  seoDescription?: string;
  noindex: boolean;
  previousSlugs: string[];
  author?: { name: string; jobTitle?: string; url?: string };
  body: PostBody;
}

const SOFT_HYPHEN = /\u00AD/g;

type Localized<T> = Partial<Record<Locale, T | null>> | null | undefined;

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
