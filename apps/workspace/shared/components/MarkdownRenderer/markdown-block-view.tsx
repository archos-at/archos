'use client'

import { memo, useMemo } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import type { PluggableList } from 'unified'
import { markdownHeadings } from './headings'
import type { MarkdownBlock } from './markdown-blocks'
import { MARKDOWN_COMPONENTS } from './markdown-components'
import { MarkdownRenderStateContext, NO_HEADINGS, type MarkdownRenderState } from './render-state-context'

export type FootnoteOptions = NonNullable<Options['remarkRehypeOptions']>

interface MarkdownBlockViewProps {
  source: string
  headingIds: string
  compact: boolean
  open: boolean
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
  footnoteOptions: FootnoteOptions
}

export const MarkdownBlockView = memo(function MarkdownBlockView({
  source,
  headingIds,
  compact,
  open,
  remarkPlugins,
  rehypePlugins,
  footnoteOptions,
}: MarkdownBlockViewProps) {
  const ids = useMemo(
    (): ReadonlyMap<number, string> =>
      headingIds ? new Map(JSON.parse(headingIds) as [number, string][]) : NO_HEADINGS,
    [headingIds]
  )
  const streamingLines = useMemo(() => (open ? source.trimEnd().split('\n') : null), [open, source])
  const renderState = useMemo(
    (): MarkdownRenderState => ({ compact, headingIds: ids, streamingLines }),
    [compact, ids, streamingLines]
  )
  return (
    <MarkdownRenderStateContext.Provider value={renderState}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={footnoteOptions}
        components={MARKDOWN_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </MarkdownRenderStateContext.Provider>
  )
})

export function headingIdsByBlock(content: string, blocks: readonly MarkdownBlock[]): string[] {
  const perBlock: [number, string][][] = blocks.map(() => [])
  let at = 0
  for (const heading of markdownHeadings(content)) {
    while (at + 1 < blocks.length && blocks[at + 1].line < heading.line) at += 1
    perBlock[at].push([heading.line - blocks[at].line, heading.id])
  }
  return perBlock.map((entries) => (entries.length > 0 ? JSON.stringify(entries) : ''))
}
