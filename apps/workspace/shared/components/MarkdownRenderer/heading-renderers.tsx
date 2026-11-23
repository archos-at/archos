'use client'

import { TableOfContents } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ExtraProps } from 'react-markdown'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { useOpenOutline } from './outline-context'
import { useMarkdownRenderState } from './render-state-context'
import { getTextFromChildren, headingAnchorId } from './utils'

function useHeadingId(node: ExtraProps['node'], children: ReactNode): string {
  const { headingIds } = useMarkdownRenderState()
  const line = node?.position?.start.line
  const assigned = line === undefined ? undefined : headingIds.get(line)
  return assigned ?? headingAnchorId(getTextFromChildren(children))
}

type HeadingProps = React.ComponentPropsWithoutRef<'h1'> & ExtraProps

export function MarkdownH1({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h1
      id={id}
      className="text-foreground mb-3 mt-8 block scroll-mt-4 text-xl font-medium"
    >
      {children}
    </h1>
  )
}

export function MarkdownH2({ children, node, id: givenId, className: givenClass }: HeadingProps) {
  const derived = useHeadingId(node, children)
  const openOutline = useOpenOutline()
  const t = useTranslations(commonCopy)
  return (
    <h2
      id={givenId ?? derived}
      className={`mb-3 mt-8 block scroll-mt-4 text-lg font-medium text-foreground hyphens-manual${givenClass ? ` ${givenClass}` : ''}`}
    >
      {openOutline ? (
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">{children}</span>
          <button
            type="button"
            onClick={openOutline}
            data-testid="outline-heading-button"
            aria-label={t('markdown.outlineOpen')}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 -my-2.5 hidden size-11 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 pointer-coarse:inline-flex print:hidden"
          >
            <TableOfContents className="size-4" aria-hidden />
          </button>
        </span>
      ) : (
        children
      )}
    </h2>
  )
}

export function MarkdownH3({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h3
      id={id}
      className="text-foreground mb-2 mt-6 block scroll-mt-4 text-base font-medium hyphens-manual"
    >
      {children}
    </h3>
  )
}

export function MarkdownH4({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h4 id={id} className="text-foreground mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h4>
  )
}

export function MarkdownH5({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h5 id={id} className="text-foreground mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h5>
  )
}

export function MarkdownH6({ children, node }: HeadingProps) {
  const id = useHeadingId(node, children)
  return (
    <h6 id={id} className="text-subtle mb-1 mt-3 block scroll-mt-4 text-sm font-medium">
      {children}
    </h6>
  )
}
