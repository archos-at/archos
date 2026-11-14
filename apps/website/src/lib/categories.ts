/**
 * The blog's three categories, defined once. The content schema, the listing routes,
 * the filter row, the feed, the sitemap and the route-fate test read this file, so
 * adding a category here is the whole change on the data side.
 *
 * Kept free of runtime imports except the brand name: content.config.ts loads
 * it while Astro builds the collection.
 */
import type { Locale } from '../i18n/paths';
import { withName } from './identity';

/** Stored in each post's frontmatter as `category`. English, as every identifier. */
export const CATEGORY_IDS = ['product', 'practice', 'technology'] as const;
export type Category = (typeof CATEGORY_IDS)[number];

interface CategoryCopy {
  /** Filter label and listing heading. */
  label: string;
  /** One line under the heading: what the category holds. */
  descriptor: string;
  /**
   * The URL segment: the label, lowercased, in kebab-case and ASCII (`/blog/praxiserfahrungen/`,
   * `/en/blog/from-practice/`). German paths are copy, as in src/i18n/paths.ts.
   */
  segment: string;
}

// `{name}` is the brand name, filled by withName.
export const CATEGORIES: Record<Locale, Record<Category, CategoryCopy>> = withName({
  de: {
    product: {
      label: 'Produktfeatures',
      descriptor: 'Was {name} kann, wie Sie es im Büro einsetzen und was neu dazukommt.',
      segment: 'produktfeatures',
    },
    practice: {
      label: 'Praxiserfahrungen',
      descriptor: 'Aus dem Alltag der Planungsbüros: Fragen, Werkzeuge und was sich bewährt.',
      segment: 'praxiserfahrungen',
    },
    technology: {
      label: 'Technologie',
      descriptor: 'Wie {name} gebaut ist, wo allgemeine Modelle an Grenzen stoßen, und warum.',
      segment: 'technologie',
    },
  },
  en: {
    product: {
      label: 'Product features',
      descriptor: 'What {name} does, how an office puts it to work, and what is new.',
      segment: 'product-features',
    },
    practice: {
      label: 'From practice',
      descriptor: 'From the everyday work of planning firms: questions, tools and what holds up.',
      segment: 'from-practice',
    },
    technology: {
      label: 'Technology',
      descriptor: 'How {name} is built, where general models reach their limits, and why.',
      segment: 'technology',
    },
  },
});

/** `/blog/` or `/blog/praxiserfahrungen/`; English under `/en/blog/` with its own segments. */
export function blogPath(locale: Locale, category?: Category) {
  const base = locale === 'en' ? '/en/blog/' : '/blog/';
  return category ? `${base}${CATEGORIES[locale][category].segment}/` : base;
}

/** The category whose segment in `locale` is `segment`, if any. */
export function categoryOfSegment(locale: Locale, segment: string): Category | undefined {
  return CATEGORY_IDS.find((id) => CATEGORIES[locale][id].segment === segment);
}

/** Every category segment of `locale`: a post slug may not take one (the two share a URL level). */
export function categorySegments(locale: Locale): string[] {
  return CATEGORY_IDS.map((id) => CATEGORIES[locale][id].segment);
}
