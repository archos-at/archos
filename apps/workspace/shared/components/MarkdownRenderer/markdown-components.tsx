'use client'

import type { Components, ExtraProps } from 'react-markdown'
import { AnswerProject } from './project-binding'
import { ANSWER_BLOCK_LABEL_TAG, ANSWER_BLOCK_TAG, ANSWER_ENERGY_TAG, ANSWER_MARKER_TAG, ANSWER_PROJECT_TAG } from './directives'
import {
  BLOCK_BODY_TAG,
  COMPARE_LABEL_TAG,
  COMPARE_ROW_TAG,
  COMPARE_STACK_TAG,
  COMPARE_TITLE_TAG,
  COMPARE_VALUE_TAG,
  COMPARE_VARIANT_TAG,
  FIGURE_LABEL_TAG,
  FIGURE_LIMIT_TAG,
  FIGURE_TAG,
  FIGURE_VALUE_TAG,
  FIGURES_TAG,
  NOT_FOUND_TAG,
  PANE_TAG,
  STEP_DETAIL_TAG,
  STEP_DUE_TAG,
  STEP_HEAD_TAG,
  SUBSUMPTION_PART_TAG,
  SUBSUMPTION_TAG,
} from './directive-shape'
import {
  AnswerBlock,
  AnswerBlockBody,
  AnswerBlockLabel,
  AnswerBlockquote,
  AnswerEnergy,
  AnswerMarker,
  CompareLabel,
  CompareRow,
  CompareStack,
  CompareValue,
  CompareVariant,
  Figure,
  Figures,
  NotFound,
  Pane,
  StepPart,
  Subsumption,
} from './directive-blocks'
import { MarkdownCode } from './code-renderer'
import { MarkdownH1, MarkdownH2, MarkdownH3, MarkdownH4, MarkdownH5, MarkdownH6 } from './heading-renderers'
import { MarkdownLink } from './link-renderer'
import { MarkdownListItem, MarkdownOrderedList, MarkdownTaskMark, MarkdownUnorderedList } from './list-renderers'
import { useMarkdownRenderState } from './render-state-context'
import { MARKDOWN_SLOT_TAG, useMarkdownSlotRenderer } from './slot-context'
import { MarkdownCaret, STREAMING_CARET_TAG } from './streaming-caret'
import { MarkdownCell, MarkdownHeaderCell } from './table-cell-renderers'
import { MarkdownCaption, MarkdownRow, MarkdownTable } from './table-renderers'

function MarkdownSlot({ index }: { index?: string }) {
  const renderSlot = useMarkdownSlotRenderer()
  const position = Number(index)
  if (!renderSlot || !Number.isInteger(position)) return null
  return <>{renderSlot(position)}</>
}

function MarkdownParagraph({ children }: React.ComponentPropsWithoutRef<'p'>) {
  const { compact } = useMarkdownRenderState()
  return (
    <p className={`text-foreground mb-4 block max-w-[72ch] ${compact ? 'text-sm leading-relaxed' : 'text-answer'}`}>
      {children}
    </p>
  )
}

export const MARKDOWN_COMPONENTS = {
  [MARKDOWN_SLOT_TAG]: MarkdownSlot,
  [STREAMING_CARET_TAG]: MarkdownCaret,
  code: MarkdownCode,
  pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
  h4: MarkdownH4,
  h5: MarkdownH5,
  h6: MarkdownH6,
  p: MarkdownParagraph,
  ul: MarkdownUnorderedList,
  ol: MarkdownOrderedList,
  li: MarkdownListItem,
  input: MarkdownTaskMark,
  a: MarkdownLink,
  strong: ({ children }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="text-foreground font-medium">{children}</strong>
  ),
  em: ({ children }: React.ComponentPropsWithoutRef<'em'>) => (
    <em className="text-foreground italic">{children}</em>
  ),
  blockquote: AnswerBlockquote,
  hr: () => <hr className="border-base my-4" />,
  table: MarkdownTable,
  caption: MarkdownCaption,
  thead: ({ children }: React.ComponentPropsWithoutRef<'thead'>) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  tbody: ({ children }: React.ComponentPropsWithoutRef<'tbody'>) => <tbody>{children}</tbody>,
  tr: MarkdownRow,
  th: MarkdownHeaderCell,
  td: MarkdownCell,
  [ANSWER_BLOCK_TAG]: AnswerBlock,
  [ANSWER_BLOCK_LABEL_TAG]: AnswerBlockLabel,
  [BLOCK_BODY_TAG]: AnswerBlockBody,
  [ANSWER_MARKER_TAG]: AnswerMarker,
  [ANSWER_ENERGY_TAG]: AnswerEnergy,
  [ANSWER_PROJECT_TAG]: AnswerProject,
  [NOT_FOUND_TAG]: NotFound,
  [PANE_TAG]: Pane,
  [SUBSUMPTION_TAG]: Subsumption,
  [SUBSUMPTION_PART_TAG]: StepPart,
  [STEP_HEAD_TAG]: StepPart,
  [STEP_DUE_TAG]: StepPart,
  [STEP_DETAIL_TAG]: StepPart,
  [FIGURES_TAG]: Figures,
  [FIGURE_TAG]: Figure,
  [FIGURE_VALUE_TAG]: StepPart,
  [FIGURE_LABEL_TAG]: StepPart,
  [FIGURE_LIMIT_TAG]: StepPart,
  [COMPARE_STACK_TAG]: CompareStack,
  [COMPARE_VARIANT_TAG]: CompareVariant,
  [COMPARE_TITLE_TAG]: StepPart,
  [COMPARE_ROW_TAG]: CompareRow,
  [COMPARE_LABEL_TAG]: CompareLabel,
  [COMPARE_VALUE_TAG]: CompareValue,
  img: ({ src, alt }: React.ComponentPropsWithoutRef<'img'> & ExtraProps) =>
    typeof src === 'string' && isSameOriginPath(src) ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? ''} loading="lazy" className="border-base my-3 h-auto max-w-full rounded-surface border" />
    ) : typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline underline-offset-2 hover:opacity-80">
        {alt || src}
      </a>
    ) : (
      <>{alt ?? ''}</>
    ),
} as Components

const isSameOriginPath = (src: string): boolean => /^\/(?![\/\\])/.test(src)
