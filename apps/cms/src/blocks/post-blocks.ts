/**
 * The blocks a post's body is made of. Each one is a component of the website's
 * design system (apps/website/src/components/PostBlocks.astro draws them), so a
 * new block is a change to both; apps/website/src/lib/cms.test.ts fails a block
 * field the website does not read.
 */
import type { Block } from 'payload';
import { CTA_TARGETS, FIGURE_COMPONENTS, options } from '../fields/choices';

export const TextBlock: Block = {
  slug: 'text',
  interfaceName: 'TextBlock',
  labels: { singular: 'Text', plural: 'Text' },
  fields: [
    {
      name: 'markdown',
      type: 'textarea',
      required: true,
      admin: {
        rows: 12,
        description: 'Markdown: headings (##), lists, links, tables, emphasis. Raw HTML is shown as text, never run.',
      },
    },
  ],
};

export const FigureBlock: Block = {
  slug: 'figure',
  interfaceName: 'FigureBlock',
  fields: [
    {
      name: 'component',
      type: 'select',
      required: true,
      options: options(FIGURE_COMPONENTS),
      admin: { description: 'A drawing of the design system (apps/website/src/components/figures).' },
    },
    { name: 'props', type: 'json', required: true, admin: { description: "The drawing's props, as JSON. Every figure takes an `alt`." } },
  ],
};

export const ImageBlock: Block = {
  slug: 'image',
  interfaceName: 'ImageBlock',
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true },
    { name: 'alt', type: 'text', required: true, admin: { description: 'What the image shows, for screen readers, in the language of this body.' } },
    { name: 'caption', type: 'text' },
  ],
};

export const QuoteBlock: Block = {
  slug: 'quote',
  interfaceName: 'QuoteBlock',
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'role', type: 'text' },
    { name: 'office', type: 'text' },
  ],
};

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

export const POST_BLOCKS = [TextBlock, FigureBlock, ImageBlock, QuoteBlock, CtaBlock];
