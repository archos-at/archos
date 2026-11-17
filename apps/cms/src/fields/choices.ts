export const COVER_DRAWINGS = [
  'answer-pipeline',
  'general-models',
  'lesson-loop',
  'office-archive',
  'review-round',
  'six-questions',
  'welcome',
] as const;

export const CATEGORIES = ['product', 'practice', 'technology'] as const;

export const FIGURE_COMPONENTS = ['iso_stack', 'scope', 'hybrid', 'lesson_loop'] as const;

export const CTA_TARGETS = ['demo', 'contact', 'security'] as const;

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const NETWORKS = ['linkedin'] as const;

export const options = (values: readonly string[]) => values.map((value) => ({ label: value, value }));
