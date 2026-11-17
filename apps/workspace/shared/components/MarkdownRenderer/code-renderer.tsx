'use client'

import type { ExtraProps } from 'react-markdown'
import { CodeBlock } from '@/shared/components/CodeBlock'
import { DiagramFence, diagramFenceKind } from './diagram-fence'
import { useMarkdownRenderState } from './render-state-context'
import { isOpenFence } from './streaming-markdown'
import { getLanguageFromClassName } from './utils'

export function MarkdownCode({
  children,
  className: codeClassName,
  node,
  ...props
}: React.ComponentPropsWithoutRef<'code'> & ExtraProps) {
  const { streamingLines } = useMarkdownRenderState()
  const rawContent = String(children)
  const isBlock = codeClassName?.startsWith('language-') || rawContent.includes('\n')
  const codeContent = rawContent.replace(/\n$/, '')

  if (!isBlock) {
    return (
      <code
        className="bg-muted text-foreground rounded-inline px-1.5 py-0.5 font-mono text-[0.875em]"
        {...props}
      >
        {children}
      </code>
    )
  }

  const drawing = diagramFenceKind(codeClassName, codeContent)
  if (drawing) {
    const at = node?.position
    const stillWriting = streamingLines !== null && at !== undefined && isOpenFence(streamingLines, at.start.line, at.end.line)
    return <DiagramFence kind={drawing} source={codeContent} isStreaming={stillWriting} />
  }

  const lineCount = codeContent.split('\n').length
  return (
    <CodeBlock
      value={codeContent}
      language={getLanguageFromClassName(codeClassName)}
      collapsible={lineCount > 15}
      maxLines={15}
    />
  )
}
