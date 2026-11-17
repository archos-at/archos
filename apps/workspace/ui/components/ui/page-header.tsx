import type { JSX } from 'react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode
  subtitle?: React.ReactNode
  subtitleOnPhone?: boolean
  action?: React.ReactNode
  crumb?: React.ReactNode
  crumbClassName?: string
  titleStart?: React.ReactNode
  titleStartClassName?: string
  titleEnd?: React.ReactNode
  actionInline?: boolean
  titleClassName?: string
  titleTooltip?: string
  titleAside?: React.ReactNode
}

const TITLE_ROW_CLASS =
  'flex min-w-0 flex-col items-stretch gap-3 phone:gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4'

const TITLE_COLUMN_CLASS = 'min-w-0 sm:min-w-56'

export const PAGE_TITLE_CLASS = 'text-page-title font-medium phone:text-section'

export function PageHeader({
  title,
  subtitle,
  subtitleOnPhone = false,
  action,
  crumb,
  crumbClassName,
  titleStart,
  titleStartClassName,
  titleEnd,
  actionInline = false,
  titleClassName,
  titleTooltip,
  titleAside,
  className,
  ...props
}: PageHeaderProps): JSX.Element {
  const heading = (
    <h1 className={cn('min-w-0 flex-1 text-balance', PAGE_TITLE_CLASS, titleClassName)} title={titleTooltip}>
      {title}
      {titleAside && <span className="ml-2 whitespace-nowrap align-baseline font-normal">{titleAside}</span>}
    </h1>
  )
  return (
    <header className={cn('min-w-0', TITLE_ROW_CLASS, actionInline && 'flex-row items-center justify-between', className)} {...props}>
      <div className={TITLE_COLUMN_CLASS}>
        {/* On a phone the title is one compact line and the description is
            gone: the tab bar and the page already say where this is, and the
            sentence cost two lines of a 393px-wide screen on every tab. A
            ratchet in `page-header.spec.tsx` holds it. */}
        {crumb && (
          <p className={cn('text-meta text-muted-foreground mb-1 flex min-w-0 items-center gap-1', crumbClassName)} data-testid="page-header-crumb">
            {crumb}
          </p>
        )}
        {titleStart || titleEnd ? (
          <div className="flex min-w-0 items-start gap-2" data-slot="page-header-title-line">
            {/* -10px each side: a 44px target on the title's 24px line. */}
            {titleStart && <div className={cn('-my-2.5 flex shrink-0 items-center', titleStartClassName)}>{titleStart}</div>}
            {heading}
            {titleEnd && <div className="-my-2.5 flex shrink-0 items-center">{titleEnd}</div>}
          </div>
        ) : (
          heading
        )}
        {subtitle && (
          <p className={cn('mt-1 text-pretty text-sm text-muted-foreground', !subtitleOnPhone && 'phone:hidden')}>{subtitle}</p>
        )}
      </div>
      {/* Inline, a 44px ⋯ hangs into the title's line height (-8px each side), so it costs the header no height. */}
      {action ? <div className={cn('min-w-0', actionInline && '-my-2 shrink-0')}>{action}</div> : null}
    </header>
  )
}
