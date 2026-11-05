/**
 * The content blocks whose contracts the website keeps in
 * apps/website/src/components/blocks/contracts.ts (and README.md there): one
 * block per entry of its `BLOCK_PARSERS`, the slug its `blockType`, the field
 * names its JSON keys, and its limits as field validation, so an editor sees a
 * problem while writing instead of a block that does not appear.
 *
 * An image is an upload here plus its alt text; the website turns the two into
 * the contract's `BlockImage` before parsing.
 */
import type { Block, Field } from 'payload';
import { options } from '../fields/choices';

/** The coarse source kinds (packages/agent/src/agent/common/source_kinds.py), as the contract mirrors them. */
export const SOURCE_KINDS = ['building_law', 'office', 'project', 'web', 'measurement'] as const;

const text = (name: string, maxLength: number, extra: Partial<Field> = {}): Field => ({ name, type: 'text', maxLength, ...extra }) as Field;
const required = (name: string, maxLength: number, extra: Partial<Field> = {}): Field => text(name, maxLength, { required: true, ...extra });
const httpsOnly = (value: unknown) =>
  value === undefined || value === null || value === '' || (typeof value === 'string' && value.startsWith('https://')) || 'An https address.';

export const ChartBlock: Block = {
  slug: 'chart',
  interfaceName: 'ChartBlock',
  labels: { singular: 'Chart', plural: 'Charts' },
  fields: [
    { name: 'form', type: 'select', required: true, defaultValue: 'bar', options: options(['bar', 'line']) },
    {
      name: 'stacking',
      type: 'select',
      options: options(['grouped', 'stacked']),
      admin: { condition: (_, sibling) => sibling?.form === 'bar', description: 'Bars with two or three series: side by side (default) or stacked.' },
    },
    required('title', 120, { admin: { description: 'The finding, as a statement: „Die Antwortzeit sank um ein Drittel.“' } }),
    text('caption', 240),
    text('unit', 12, { admin: { description: '%, h, m², Tage' } }),
    text('axisLabel', 60),
    { name: 'decimals', type: 'number', min: 0, max: 2 },
    { name: 'startAtZero', type: 'checkbox', admin: { condition: (_, sibling) => sibling?.form === 'line', description: 'Lines: start the axis at zero (unticked: from the data).' } },
    {
      name: 'table',
      type: 'textarea',
      required: true,
      admin: {
        rows: 6,
        description: 'Paste from a spreadsheet, or type rows with ; between cells. First row: the series; first column: the labels. 2 to 24 rows, 1 to 3 series.',
      },
    },
    required('source', 200, { admin: { description: 'Where the numbers come from.' } }),
    text('sourceUrl', 500, { validate: httpsOnly }),
  ],
};

export const KeyFiguresBlock: Block = {
  slug: 'keyFigures',
  interfaceName: 'KeyFiguresBlock',
  labels: { singular: 'Key figures', plural: 'Key figures' },
  fields: [
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 2,
      maxRows: 4,
      fields: [
        required('value', 8, { admin: { description: 'As it is read: 3,5 or 1.284.' } }),
        text('unit', 8),
        required('label', 60),
        text('source', 200),
      ],
    },
  ],
};

const image = (prefix: string, label: string): Field[] => [
  { name: prefix, type: 'upload', relationTo: 'media', required: true, label },
  required(`${prefix}Alt`, 300, { label: `${label}: alt text` }),
];

export const CompareBlock: Block = {
  slug: 'compare',
  interfaceName: 'CompareBlock',
  labels: { singular: 'Before and after', plural: 'Before and after' },
  fields: [
    ...image('before', 'Before'),
    ...image('after', 'After'),
    required('beforeLabel', 40, { admin: { description: 'e.g. Rev. C, 12.09.' } }),
    required('afterLabel', 40),
    text('caption', 240),
    { name: 'start', type: 'number', min: 0, max: 100, admin: { description: 'Where the divider starts, in percent from the left (50).' } },
  ],
};

export const AnnotatedImageBlock: Block = {
  slug: 'annotatedImage',
  interfaceName: 'AnnotatedImageBlock',
  labels: { singular: 'Annotated image', plural: 'Annotated images' },
  fields: [
    ...image('image', 'Image'),
    {
      name: 'markers',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 9,
      fields: [
        { name: 'x', type: 'number', required: true, min: 0, max: 100, admin: { description: 'Percent of the width, from the left.' } },
        { name: 'y', type: 'number', required: true, min: 0, max: 100, admin: { description: 'Percent of the height, from the top.' } },
        required('title', 80),
        text('text', 280),
      ],
    },
    text('caption', 240),
  ],
};

export const LegalSourceBlock: Block = {
  slug: 'legalSource',
  interfaceName: 'LegalSourceBlock',
  labels: { singular: 'Legal source', plural: 'Legal sources' },
  fields: [
    required('title', 80, { admin: { description: 'OIB-Richtlinie 2.2, Wiener Bauordnung' } }),
    text('section', 60),
    text('version', 60, { admin: { description: 'Ausgabe Mai 2023, Fassung vom 01.01.2025' } }),
    text('issuer', 100),
    { name: 'excerpt', type: 'textarea', maxLength: 600, admin: { description: 'The wording, short and verbatim.' } },
    { name: 'excerptLang', type: 'select', options: options(['de', 'en']), admin: { description: "The excerpt's language, when it is not the page's." } },
    text('url', 500, { validate: httpsOnly }),
  ],
};

export const QaExcerptBlock: Block = {
  slug: 'qaExcerpt',
  interfaceName: 'QaExcerptBlock',
  labels: { singular: 'Question and answer', plural: 'Questions and answers' },
  fields: [
    { name: 'question', type: 'textarea', required: true, maxLength: 400 },
    { name: 'answer', type: 'textarea', required: true, maxLength: 2000, admin: { description: 'Markdown: paragraphs, bold, lists. Raw HTML is shown as text.' } },
    {
      name: 'sources',
      type: 'array',
      maxRows: 6,
      fields: [
        { name: 'kind', type: 'select', required: true, options: options(SOURCE_KINDS) },
        required('title', 80),
        text('detail', 40),
      ],
    },
    { name: 'sourceCount', type: 'number', min: 1, max: 999, admin: { description: 'How many sources the answer drew on, when more than shown.' } },
    text('asker', 80, { admin: { description: 'Who asked, without a name: Projektleiterin, Wohnbau in Wien.' } }),
    text('caption', 240),
  ],
};

export const KeyTakeawaysBlock: Block = {
  slug: 'keyTakeaways',
  interfaceName: 'KeyTakeawaysBlock',
  labels: { singular: 'Key takeaways', plural: 'Key takeaways' },
  fields: [
    text('title', 60, { admin: { description: 'Empty: „Das Wichtigste in Kürze“ / „Key takeaways“.' } }),
    { name: 'items', type: 'array', required: true, minRows: 3, maxRows: 5, fields: [required('text', 200)] },
  ],
};

export const CONTENT_BLOCKS: Block[] = [ChartBlock, KeyFiguresBlock, CompareBlock, AnnotatedImageBlock, LegalSourceBlock, QaExcerptBlock, KeyTakeawaysBlock];
