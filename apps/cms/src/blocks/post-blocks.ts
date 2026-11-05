/**
 * The blocks an editor inserts into a post's body (Lexical's BlocksFeature).
 * Each one is a component of the website's design system, with the component's
 * props as typed fields, so a block holds nothing the component cannot draw and
 * there is no block that takes raw HTML, MDX or script.
 *
 * Adding a block is two files and a migration (apps/cms/README.md, "Adding a
 * block"): its config here, added to `POST_BLOCKS` or `POST_INLINE_BLOCKS`, and
 * its case in apps/website/src/components/PostBlock.astro. The website's
 * `src/lib/rich-text.test.ts` fails a block slug that the website does not draw.
 */
import type { Block, Field } from 'payload';
import { CTA_TARGETS, options } from '../fields/choices';

/** The frame every figure sits in (apps/website/src/components/figures/FigureFrame.astro). */
const FRAME: Field[] = [
  { name: 'alt', type: 'textarea', required: true, admin: { description: 'What the drawing shows, for screen readers. Required: the text in a drawing is not enough.' } },
  { name: 'kicker', type: 'text', admin: { description: 'Short tag above the figure, e.g. ABB. 01.' } },
  { name: 'title', type: 'text' },
  { name: 'caption', type: 'textarea', admin: { description: 'The sentence under the figure.' } },
];

const SIDES = options(['left', 'right']);

/** apps/website/src/components/figures/IsoStackFigure.astro */
export const IsoStackFigureBlock: Block = {
  slug: 'isoStackFigure',
  interfaceName: 'IsoStackFigureBlock',
  labels: { singular: 'Figure: isometric stack', plural: 'Figures: isometric stack' },
  fields: [
    {
      name: 'layers',
      type: 'array',
      required: true,
      minRows: 1,
      admin: { description: 'Top layer first.' },
      fields: [
        { name: 'label', type: 'text', required: true, admin: { description: 'Upper-case label, e.g. SOURCES.' } },
        { name: 'sublabel', type: 'text' },
        { name: 'side', type: 'select', options: SIDES, admin: { description: 'Where the label sits. Empty: alternating.' } },
        { name: 'accent', type: 'checkbox', defaultValue: false },
        { name: 'glyph', type: 'select', options: options(['tiles', 'funnel', 'disc', 'lines', 'doc', 'check']) },
      ],
    },
    {
      name: 'satellites',
      type: 'array',
      admin: { description: 'Side systems that feed a layer: dashed boxes below the stack.' },
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'sub', type: 'text' },
        { name: 'layer', type: 'number', required: true, min: 0, admin: { description: 'The layer it feeds, 0 = top.' } },
        { name: 'side', type: 'select', required: true, options: SIDES },
      ],
    },
    ...FRAME,
  ],
};

/** apps/website/src/components/figures/ScopeFigure.astro */
export const ScopeFigureBlock: Block = {
  slug: 'scopeFigure',
  interfaceName: 'ScopeFigureBlock',
  labels: { singular: 'Figure: nested scopes', plural: 'Figures: nested scopes' },
  fields: [
    {
      name: 'levels',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 4,
      admin: { description: 'Outermost first; four fit.' },
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'holds', type: 'text', required: true, admin: { description: 'What lives at this level.' } },
        { name: 'visible', type: 'text', required: true, admin: { description: 'Who can see it.' } },
      ],
    },
    { name: 'search', type: 'text', required: true, admin: { description: 'The label on the outward search arrow.' } },
    ...FRAME,
  ],
};

const labelPair = (name: string): Field[] => [
  { name, type: 'text', required: true },
  { name: `${name}Sub`, type: 'text', required: true },
];

/** apps/website/src/components/figures/HybridFigure.astro */
export const HybridFigureBlock: Block = {
  slug: 'hybridFigure',
  interfaceName: 'HybridFigureBlock',
  labels: { singular: 'Figure: hybrid retrieval', plural: 'Figures: hybrid retrieval' },
  fields: [
    { name: 'labels', type: 'group', fields: ['query', 'semantic', 'lexical', 'merge', 'cap'].flatMap(labelPair) },
    ...FRAME,
  ],
};

/** apps/website/src/components/figures/LessonLoopFigure.astro */
export const LessonLoopFigureBlock: Block = {
  slug: 'lessonLoopFigure',
  interfaceName: 'LessonLoopFigureBlock',
  labels: { singular: 'Figure: lesson loop', plural: 'Figures: lesson loop' },
  fields: [
    {
      name: 'labels',
      type: 'group',
      fields: [
        {
          name: 'steps',
          type: 'array',
          required: true,
          minRows: 6,
          maxRows: 6,
          admin: { description: 'Exactly six, clockwise from top left.' },
          fields: [
            { name: 'label', type: 'text', required: true },
            { name: 'sub', type: 'text', required: true },
          ],
        },
        { name: 'loop', type: 'text', required: true, admin: { description: 'The label on the closing edge.' } },
        ...labelPair('holdout'),
      ],
    },
    ...FRAME,
  ],
};

/** An image in the figures' frame, cut at its focal point by the CMS's sizes. */
export const ImageBlock: Block = {
  slug: 'image',
  interfaceName: 'ImageBlock',
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true, admin: { description: 'Set its focal point in the media library.' } },
    { name: 'alt', type: 'text', required: true, admin: { description: 'What the image shows, for screen readers, in the language of this body.' } },
    { name: 'caption', type: 'text' },
  ],
};

/** A product screenshot: the whole image, uncropped, with the figures' kicker and title. */
export const ScreenshotBlock: Block = {
  slug: 'screenshot',
  interfaceName: 'ScreenshotBlock',
  labels: { singular: 'Product screenshot', plural: 'Product screenshots' },
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true },
    ...FRAME.map((field) => (field.type === 'textarea' && field.name === 'alt' ? { ...field, admin: { description: 'What the screenshot shows.' } } : field)),
  ],
};

/** apps/website/src/components/Gallery.astro: a carousel of images with a sentence each. */
export const GalleryBlock: Block = {
  slug: 'gallery',
  interfaceName: 'GalleryBlock',
  fields: [
    { name: 'label', type: 'text', required: true, admin: { description: 'The carousel\'s accessible name.' } },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'title', type: 'text', required: true, admin: { description: 'The topic, e.g. "Suchen."' } },
        { name: 'text', type: 'text', admin: { description: 'The rest of the sentence.' } },
        { name: 'image', type: 'upload', relationTo: 'media' },
        { name: 'alt', type: 'text' },
      ],
    },
  ],
};

/** apps/website/src/components/Callout.astro: a note set off from the text. */
export const CalloutBlock: Block = {
  slug: 'callout',
  interfaceName: 'CalloutBlock',
  fields: [
    { name: 'tone', type: 'select', required: true, defaultValue: 'note', options: options(['note', 'important']) },
    { name: 'title', type: 'text' },
    { name: 'text', type: 'textarea', required: true },
  ],
};

/** apps/website/src/components/Quote.astro */
export const QuoteBlock: Block = {
  slug: 'quote',
  interfaceName: 'QuoteBlock',
  labels: { singular: 'Quote (person)', plural: 'Quotes (person)' },
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'role', type: 'text' },
    { name: 'office', type: 'text' },
  ],
};

/** apps/website/src/components/CTABand.astro, pointing at pages of the site by route key. */
export const CtaBlock: Block = {
  slug: 'cta',
  interfaceName: 'CtaBlock',
  labels: { singular: 'Call to action', plural: 'Calls to action' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'text', type: 'textarea' },
    { name: 'primary', type: 'select', options: options(CTA_TARGETS), admin: { description: 'A page of the site, by its route key.' } },
    { name: 'secondary', type: 'select', options: options(CTA_TARGETS) },
  ],
};

export const CODE_LANGUAGES = ['text', 'bash', 'json', 'yaml', 'typescript', 'python', 'sql'] as const;

/** Source code, shown as text: escaped, never run, never highlighted by a script. */
export const CodeBlock: Block = {
  slug: 'code',
  interfaceName: 'CodeBlock',
  fields: [
    { name: 'language', type: 'select', required: true, defaultValue: 'text', options: options(CODE_LANGUAGES) },
    { name: 'code', type: 'textarea', required: true, admin: { rows: 10 } },
  ],
};

/** Inline: an abbreviation with its expansion (`<abbr title>`), e.g. OIB. */
export const AbbreviationInlineBlock: Block = {
  slug: 'abbreviation',
  interfaceName: 'AbbreviationInlineBlock',
  fields: [
    { name: 'text', type: 'text', required: true, admin: { description: 'As it stands in the sentence, e.g. OIB.' } },
    { name: 'expansion', type: 'text', required: true, admin: { description: 'Written out, e.g. Österreichisches Institut für Bautechnik.' } },
  ],
};

export const FIGURE_BLOCKS = [IsoStackFigureBlock, ScopeFigureBlock, HybridFigureBlock, LessonLoopFigureBlock];
export const POST_BLOCKS: Block[] = [
  ...FIGURE_BLOCKS,
  ImageBlock,
  ScreenshotBlock,
  GalleryBlock,
  CalloutBlock,
  QuoteBlock,
  CtaBlock,
  CodeBlock,
];
export const POST_INLINE_BLOCKS: Block[] = [AbbreviationInlineBlock];
