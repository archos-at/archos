/**
 * The editor of a post's body: Lexical with what a post needs and nothing that
 * runs. Headings h2 to h4 (the post's title is the h1), paragraphs, bold,
 * italic, strikethrough, inline code, links, bulleted and numbered lists, block
 * quotes, tables, a horizontal rule, and the blocks of `blocks/post-blocks.ts`.
 *
 * Left out on purpose: uploads as nodes (an image is the Image block, with alt
 * text and caption per language), relationships, alignment, colours, raw HTML.
 * The website renders the stored JSON node by node into its own components and
 * never as HTML it did not write (apps/website/src/components/RichText.astro).
 */
import {
  BlockquoteFeature,
  BlocksFeature,
  BoldFeature,
  EXPERIMENTAL_TableFeature,
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  InlineCodeFeature,
  InlineToolbarFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  StrikethroughFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical';
import { POST_BLOCKS, POST_INLINE_BLOCKS } from '../blocks/post-blocks';

export const HEADING_SIZES = ['h2', 'h3', 'h4'] as const;

export const postBodyEditor = lexicalEditor({
  features: () => [
    ParagraphFeature(),
    HeadingFeature({ enabledHeadingSizes: [...HEADING_SIZES] }),
    BoldFeature(),
    ItalicFeature(),
    StrikethroughFeature(),
    InlineCodeFeature(),
    // URLs only: a link to another post is its URL, which survives a move by its former slugs.
    LinkFeature({ enabledCollections: [] }),
    UnorderedListFeature(),
    OrderedListFeature(),
    BlockquoteFeature(),
    EXPERIMENTAL_TableFeature(),
    HorizontalRuleFeature(),
    BlocksFeature({ blocks: POST_BLOCKS, inlineBlocks: POST_INLINE_BLOCKS }),
    FixedToolbarFeature(),
    InlineToolbarFeature(),
  ],
});
