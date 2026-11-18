import type { Locale } from '../i18n/paths';
import { withName } from './identity';

export const CATEGORY_IDS = ['product', 'practice', 'technology'] as const;
export type Category = (typeof CATEGORY_IDS)[number];

interface CategoryCopy {
  label: string;
  descriptor: string;
  segment: string;
}

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

export function blogPath(locale: Locale, category?: Category) {
  const base = locale === 'en' ? '/en/blog/' : '/blog/';
  return category ? `${base}${CATEGORIES[locale][category].segment}/` : base;
}

export function categoryOfSegment(locale: Locale, segment: string): Category | undefined {
  return CATEGORY_IDS.find((id) => CATEGORIES[locale][id].segment === segment);
}

export function categorySegments(locale: Locale): string[] {
  return CATEGORY_IDS.map((id) => CATEGORIES[locale][id].segment);
}
