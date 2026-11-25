'use client'

import { type FC, memo, useMemo, useState } from 'react'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { normalizeDirectiveFences } from '@/lib/text/answer-directives'
import { remarkAnswerDirectives } from './directives'
import { MarkdownBlockView, headingIdsByBlock, type FootnoteOptions } from './markdown-block-view'
import { remarkBlockContinues, splitMarkdownBlocks } from './markdown-blocks'
import { rehypePluginsFor } from './rehype-plugins'
import { MarkdownStreamStateContext, type MarkdownStreamState } from './render-state-context'
import { stabilizeStreamingMarkdown } from './streaming-markdown'
import { StreamingCaretProvider } from './streaming-caret'
import type { MarkdownRendererProps } from './types'

export { holdHalfDirective, isOpenFence, stabilizeStreamingMarkdown } from './streaming-markdown'

export const MarkdownRenderer: FC<MarkdownRendererProps> = memo(
  ({ content, className = '', compact = false, isStreaming = false, remarkPlugins, caret }) => {
    const t = useTranslations(commonCopy)
    const [streamedHere, setStreamedHere] = useState(isStreaming)
    if (isStreaming && !streamedHere) setStreamedHere(true)
    const footnoteOptions = useMemo(
      (): FootnoteOptions => ({
        footnoteLabel: t('markdown.footnotes'),
        footnoteLabelProperties: { className: ['sr-only'] },
        footnoteBackLabel: (referenceIndex: number) =>
          t('markdown.backToReference', { n: referenceIndex + 1 }),
      }),
      [t]
    )
    const plugins = useMemo(() => {
      const last: PluggableList = [remarkGfm, remarkMath, remarkDirective, remarkAnswerDirectives, ...(remarkPlugins ?? [])]
      return { last, notLast: [remarkBlockContinues, ...last] }
    }, [remarkPlugins])
    const renderedContent = useMemo(
      () => normalizeDirectiveFences(isStreaming ? stabilizeStreamingMarkdown(content) : content),
      [isStreaming, content]
    )
    const blocks = useMemo(
      () => splitMarkdownBlocks(renderedContent) ?? [{ source: renderedContent, line: 0 }],
      [renderedContent]
    )
    const headingIds = useMemo(() => headingIdsByBlock(renderedContent, blocks), [renderedContent, blocks])

    const withCaret = isStreaming && caret !== undefined && caret !== null && caret !== false
    const streamState = useMemo(
      (): MarkdownStreamState => ({ streaming: isStreaming, streamedHere }),
      [isStreaming, streamedHere]
    )

    return (
      <StreamingCaretProvider value={withCaret ? caret : null}>
        <MarkdownStreamStateContext.Provider value={streamState}>
          <div
            className={`markdown-content hyphens-auto [hyphenate-limit-chars:10_4_4] break-words [overflow-wrap:anywhere] [&>*:last-child]:mb-0 ${className}`}
          >
            {blocks.map((block, index) => {
              const last = index === blocks.length - 1
              return (
                <MarkdownBlockView
                  key={index}
                  source={block.source}
                  headingIds={headingIds[index] ?? ''}
                  compact={compact}
                  open={isStreaming && last}
                  remarkPlugins={last ? plugins.last : plugins.notLast}
                  rehypePlugins={rehypePluginsFor(index === 0, isStreaming && last, withCaret)}
                  footnoteOptions={footnoteOptions}
                />
              )
            })}
          </div>
        </MarkdownStreamStateContext.Provider>
      </StreamingCaretProvider>
    )
  }
)

MarkdownRenderer.displayName = 'MarkdownRenderer'
