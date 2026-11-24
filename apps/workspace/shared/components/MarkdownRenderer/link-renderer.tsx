'use client'

import type { ExtraProps } from 'react-markdown'
import { scrollToAnchor, useInPageAnchorRenderer } from './anchor-context'
import { isInternalHref, useInternalLinkRenderer } from './internal-link-context'

export function MarkdownLink({ href, children, node: _node, ...rest }: React.ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const renderInPageAnchor = useInPageAnchorRenderer()
  const renderInternalLink = useInternalLinkRenderer()
  const extra = rest as Record<string, unknown>
  const footnoteRef = extra['data-footnote-ref'] as boolean | undefined
  const footnoteBackref = extra['data-footnote-backref'] as boolean | undefined
  const isFootnote = footnoteRef !== undefined || footnoteBackref !== undefined
  if (href?.startsWith('#')) {
    if (renderInPageAnchor && !isFootnote) {
      return <>{renderInPageAnchor({ href, children })}</>
    }
    return (
      <a
        href={href}
        aria-label={extra['aria-label'] as string | undefined}
        data-footnote-ref={footnoteRef}
        data-footnote-backref={footnoteBackref}
        className="text-brand underline underline-offset-2 hover:opacity-80"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault()
          scrollToAnchor(href.slice(1))
        }}
      >
        {children}
      </a>
    )
  }
  if (isInternalHref(href)) {
    if (renderInternalLink) {
      return <>{renderInternalLink({ href, children })}</>
    }
    return (
      <a href={href} className="text-brand underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    )
  }
  return (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  )
}
