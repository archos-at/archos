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
