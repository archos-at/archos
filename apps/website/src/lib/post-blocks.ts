/**
 * The blocks of a CMS post's body and the props each one's component takes
 * (apps/cms/src/blocks/post-blocks.ts holds the CMS side). Pure: a block's
 * fields in, its component's props out, or undefined when the block lacks what
 * its component needs, which leaves it out rather than drawing half of it.
 *
 * Adding a block on this side is two lines: its props here, its component in
 * `src/components/PostBlock.astro`. `src/lib/rich-text.test.ts` fails a block of
 * the CMS that has no entry here, and one here that PostBlock.astro does not draw.
 */
import type { ImageSize } from './cms';
import type { MediaFile } from './post-model';

type Fields = Record<string, unknown>;

/** Fields Payload adds to every block and array row that no component takes. */
const INTERNAL = new Set(['id', 'blockName', 'blockType']);

/**
 * A block's fields as plain props: Payload's ids and names out, and every empty
 * value (null, undefined) dropped, so a field nobody set is a prop nobody passed,
 * exactly as an MDX figure that leaves it out.
 */
export function plainProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plainProps);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => !INTERNAL.has(key) && v !== null && v !== undefined)
        .map(([key, v]) => [key, plainProps(v)]),
    );
  }
  return value;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const rows = (value: unknown): Fields[] => (Array.isArray(value) ? value.filter((r): r is Fields => !!r && typeof r === 'object') : []);

/** An upload field, populated (`depth=1`): the media document, or undefined when it did not populate. */
export function mediaOf(value: unknown): MediaFile | undefined {
  const file = value as MediaFile | null | undefined;
  return file && typeof file === 'object' && typeof file.url === 'string' ? file : undefined;
}

/** A figure: its props as the CMS holds them, when it has its alt text and the list it draws. */
const figure = (list: string) => (fields: Fields) =>
  text(fields.alt) && (list === '' || rows(fields[list]).length > 0) ? (plainProps(fields) as Fields) : undefined;

export interface RenderedImage {
  file: MediaFile;
  alt: string;
  aiGenerated: boolean;
}

const image = (fields: Fields, key = 'image'): RenderedImage | undefined => {
  const file = mediaOf(fields[key]);
  const alt = text(fields.alt);
  return file && alt ? { file, alt, aiGenerated: file.aiGenerated === true } : undefined;
};

export const CTA_TARGETS = ['demo', 'contact', 'security'] as const;
export type CtaTarget = (typeof CTA_TARGETS)[number];
const cta = (value: unknown): CtaTarget | undefined => CTA_TARGETS.find((t) => t === value);

/** Every block of the CMS, by its slug, and the props its component takes. */
export const BLOCK_PROPS = {
  isoStackFigure: figure('layers'),
  scopeFigure: (fields: Fields) => (text(fields.search) ? figure('levels')(fields) : undefined),
  hybridFigure: (fields: Fields) => (fields.labels && typeof fields.labels === 'object' ? figure('')(fields) : undefined),
  lessonLoopFigure: (fields: Fields) => (rows((fields.labels as Fields | undefined)?.steps).length === 6 ? figure('')(fields) : undefined),
  image: (fields: Fields) => {
    const img = image(fields);
    return img && { ...img, caption: text(fields.caption) };
  },
  screenshot: (fields: Fields) => {
    const img = image(fields);
    return img && { ...img, kicker: text(fields.kicker), title: text(fields.title), caption: text(fields.caption) };
  },
  gallery: (fields: Fields) => {
    const items = rows(fields.items)
      .filter((row) => text(row.title))
      .map((row) => ({ title: row.title as string, text: text(row.text), file: mediaOf(row.image), alt: text(row.alt) }));
    return text(fields.label) && items.length > 0 ? { label: fields.label as string, items } : undefined;
  },
  callout: (fields: Fields) =>
    text(fields.text) ? { tone: fields.tone === 'important' ? ('important' as const) : ('note' as const), title: text(fields.title), text: fields.text as string } : undefined,
  quote: (fields: Fields) =>
    text(fields.quote) && text(fields.name)
      ? { quote: fields.quote as string, name: fields.name as string, role: text(fields.role), office: text(fields.office) }
      : undefined,
  cta: (fields: Fields) => (text(fields.title) ? { title: fields.title as string, text: text(fields.text), primary: cta(fields.primary), secondary: cta(fields.secondary) } : undefined),
  code: (fields: Fields) => (typeof fields.code === 'string' ? { language: text(fields.language) ?? 'text', code: fields.code } : undefined),
} satisfies Record<string, (fields: Fields) => unknown>;

/** Inline blocks, inside a paragraph. */
export const INLINE_BLOCK_PROPS = {
  abbreviation: (fields: Fields) => (text(fields.text) && text(fields.expansion) ? { text: fields.text as string, expansion: fields.expansion as string } : undefined),
} satisfies Record<string, (fields: Fields) => unknown>;

export type BlockSlug = keyof typeof BLOCK_PROPS;
export type BlockProps<S extends BlockSlug> = NonNullable<ReturnType<(typeof BLOCK_PROPS)[S]>>;

/** The block's slug and props, or undefined for a block this site does not draw (a newer CMS than the site). */
export function blockOf(fields: unknown): { [S in BlockSlug]: { slug: S; props: BlockProps<S> } }[BlockSlug] | undefined {
  const f = (fields ?? {}) as Fields;
  const slug = f.blockType as BlockSlug;
  if (!(slug in BLOCK_PROPS)) return undefined;
  const props = BLOCK_PROPS[slug](f);
  return props ? ({ slug, props } as never) : undefined;
}

/** The sizes an image in a post's body is served in. */
export const INLINE_SIZES: ImageSize[] = ['inline-small', 'inline'];
