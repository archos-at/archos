/**
 * A blog post as the views render it, whichever source it came from: the CMS
 * (Directus, ADR-0155) or the MDX fixtures in src/content/blog that the site
 * falls back to without one. Pure: `fromCms` maps the CMS's JSON, and the tests
 * hold it to the shape the CMS's sync files define (apps/cms/directus).
 */
import type { CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n/paths';
import { CATEGORY_IDS, type Category } from './categories';

export type Cover =
  | { kind: 'drawing'; id: string }
  | { kind: 'image'; file: string; alt: string; aiGenerated: boolean };

export type FigureComponent = 'iso_stack' | 'scope' | 'hybrid' | 'lesson_loop';

export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'figure'; component: FigureComponent; props: Record<string, unknown> }
  | { kind: 'image'; file: string; alt: string; caption?: string; aiGenerated: boolean }
  | { kind: 'quote'; quote: string; name: string; role?: string; office?: string }
  | { kind: 'cta'; title: string; text?: string; primary?: string; secondary?: string };

export type PostBody = { kind: 'mdx'; entry: CollectionEntry<'blog'> } | { kind: 'blocks'; blocks: Block[] };

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

const SOFT_HYPHEN = /­/g;
const FIGURES: FigureComponent[] = ['iso_stack', 'scope', 'hybrid', 'lesson_loop'];

/* The CMS's JSON, as the `fields` in cms.ts read it. Loose on purpose: it crosses a network. */
interface CmsBlockRow {
  collection: string;
  item: Record<string, unknown> | null;
}
interface CmsTranslation {
  languages_code: string;
  title: string;
  slug: string;
  description: string;
  seo_title?: string | null;
  seo_description?: string | null;
  noindex?: boolean | null;
  previous_slugs?: string[] | null;
  blocks?: CmsBlockRow[] | null;
}
export interface CmsPost {
  id: string;
  publish_date: string;
  date_updated?: string | null;
  category: string;
  cover_type?: string | null;
  cover?: string | null;
  cover_image?: string | null;
  cover_alt?: string | null;
  cover_ai_generated?: boolean | null;
  author?: { name: string; job_title?: string | null; profile_url?: string | null } | null;
  translations: CmsTranslation[];
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** One block row, or undefined for a kind this site does not render (a newer CMS than the site). */
export function blockFromCms(row: CmsBlockRow): Block | undefined {
  const item = row.item ?? {};
  switch (row.collection) {
    case 'block_markdown':
      return text(item.text) ? { kind: 'markdown', text: item.text as string } : undefined;
    case 'block_figure': {
      const component = item.component as FigureComponent;
      if (!FIGURES.includes(component) || typeof item.props !== 'object' || item.props === null) return undefined;
      return { kind: 'figure', component, props: item.props as Record<string, unknown> };
    }
    case 'block_image':
      if (!text(item.image) || !text(item.alt)) return undefined;
      return { kind: 'image', file: item.image as string, alt: item.alt as string, caption: text(item.caption), aiGenerated: item.ai_generated === true };
    case 'block_quote':
      if (!text(item.quote) || !text(item.name)) return undefined;
      return { kind: 'quote', quote: item.quote as string, name: item.name as string, role: text(item.role), office: text(item.office) };
    case 'block_cta':
      if (!text(item.title)) return undefined;
      return { kind: 'cta', title: item.title as string, text: text(item.text), primary: text(item.primary), secondary: text(item.secondary) };
    default:
      return undefined;
  }
}

function coverFromCms(post: CmsPost): Cover | undefined {
  if (post.cover_type === 'image') {
    if (!post.cover_image || !post.cover_alt) return undefined;
    return { kind: 'image', file: post.cover_image, alt: post.cover_alt, aiGenerated: post.cover_ai_generated === true };
  }
  return post.cover ? { kind: 'drawing', id: post.cover } : undefined;
}

/**
 * The post in `locale`, or undefined when it has no such translation or holds
 * something this site cannot show (an unknown category, no cover).
 */
export function fromCms(post: CmsPost, locale: Locale): Post | undefined {
  const own = post.translations.find((t) => t.languages_code === locale);
  const category = post.category as Category;
  const cover = coverFromCms(post);
  if (!own || !CATEGORY_IDS.includes(category) || !cover) return undefined;
  const twin = post.translations.find((t) => t.languages_code !== locale);
  return {
    locale,
    slug: own.slug,
    title: own.title.replace(SOFT_HYPHEN, ''),
    heading: own.title,
    description: own.description,
    pubDate: new Date(post.publish_date),
    updated: post.date_updated ? new Date(post.date_updated) : undefined,
    category,
    cover,
    translationSlug: twin?.slug,
    seoTitle: text(own.seo_title),
    seoDescription: text(own.seo_description),
    noindex: own.noindex === true,
    previousSlugs: own.previous_slugs ?? [],
    author: post.author?.name
      ? { name: post.author.name, jobTitle: text(post.author.job_title), url: text(post.author.profile_url) }
      : undefined,
    body: { kind: 'blocks', blocks: (own.blocks ?? []).map(blockFromCms).filter((b): b is Block => b !== undefined) },
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
