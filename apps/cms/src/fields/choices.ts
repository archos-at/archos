/**
 * The values the CMS offers that the website owns in code. `tests/choices.test.ts`
 * holds each list to its source in apps/website, so a new drawing or category
 * is a pull request to both, never a value only one of them knows.
 */

/** The line drawings in apps/website/src/assets/covers (drawn by packages/brand/docs/blog-covers.md). */
export const COVER_DRAWINGS = [
  'answer-pipeline',
  'general-models',
  'lesson-loop',
  'office-archive',
  'review-round',
  'six-questions',
  'welcome',
] as const;

/** CATEGORY_IDS of apps/website/src/lib/categories.ts; the website owns the labels and URL segments. */
export const CATEGORIES = ['product', 'practice', 'technology'] as const;

/** The website's figure components (apps/website/src/components/figures), by the key a figure block stores. */
export const FIGURE_COMPONENTS = ['iso_stack', 'scope', 'hybrid', 'lesson_loop'] as const;

/** The pages a call to action may point at, by their route key in apps/website/src/i18n/paths.ts. */
export const CTA_TARGETS = ['demo', 'contact', 'security'] as const;

/** The two languages of the website; German is the default and the fallback nothing falls back to. */
export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The networks a social account can be on. */
export const NETWORKS = ['linkedin'] as const;

export const options = (values: readonly string[]) => values.map((value) => ({ label: value, value }));
