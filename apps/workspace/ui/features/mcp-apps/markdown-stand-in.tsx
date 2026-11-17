import type { FC } from 'react'

const SKETCH_FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*excalidraw[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gim

export const MarkdownRenderer: FC<{ content: string }> = ({ content }) => (
  <p className="text-foreground text-sm whitespace-pre-wrap">{content.replace(SKETCH_FENCE, '[Skizze]')}</p>
)
