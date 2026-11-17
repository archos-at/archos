'use client'

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { RaisedCard, RaisedCardBody, RaisedCardFooter } from '@/components/ui/raised-card'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'

export function BentoGrid({
  className,
  children,
  ...rest
}: {
  className?: string
  children: ReactNode
  'data-testid'?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'grid grid-flow-dense auto-rows-[minmax(9rem,auto)] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

const SPANS = {
  small: 'lg:col-span-2',
  half: 'lg:col-span-3',
  major: 'md:col-span-2 lg:col-span-4',
  hero: 'md:col-span-2 lg:col-span-4 lg:row-span-2',
  tall: 'lg:col-span-2 lg:row-span-2',
  wide: 'md:col-span-2 lg:col-span-6',
} as const

export type BentoSpan = keyof typeof SPANS

export function BentoCell({
  span = 'small',
  className,
  children,
}: {
  span?: BentoSpan
  className?: string
  children: ReactNode
}): JSX.Element {
  return <div className={cn('min-w-0 [&>*]:h-full', SPANS[span], className)}>{children}</div>
}

export interface BentoTileProps {
  label: string
  icon?: LucideIcon
  tone?: StatCardIconTone
  span?: BentoSpan
  action?: ReactNode
  href?: string
  linkLabel?: string
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
  'data-testid'?: string
}

export function BentoTile({
  label,
  icon,
  tone,
  span = 'small',
  action,
  href,
  linkLabel,
  footer,
  className,
  bodyClassName,
  children,
  'data-testid': testId,
}: BentoTileProps): JSX.Element {
  const hasFooter = Boolean(footer || (href && linkLabel))
  return (
    <RaisedCard
      role="region"
      aria-label={label}
      className={cn(SPANS[span], className)}
      data-testid={testId}
    >
      <RaisedCardBody className={cn('flex flex-1 flex-col gap-3 p-5', bodyClassName)}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          {tone && icon ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <StatCardIcon icon={icon} tone={tone} size="sm" />
              <SectionLabel as="h2">{label}</SectionLabel>
            </div>
          ) : (
            <SectionLabel as="h2" icon={icon}>
              {label}
            </SectionLabel>
          )}
          {action}
        </div>
        {children}
      </RaisedCardBody>
      {hasFooter && (
        <RaisedCardFooter className="justify-between">
          <span className="min-w-0 truncate">{footer}</span>
          {href && linkLabel && (
            <Link
              href={href}
              className="hover:text-foreground duration-quick inline-flex shrink-0 items-center gap-1 font-medium transition-colors ease-out motion-reduce:transition-none"
            >
              {linkLabel}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </RaisedCardFooter>
      )}
    </RaisedCard>
  )
}

export function BentoFigure({
  value,
  caption,
  className,
}: {
  value: ReactNode
  caption?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-3xl font-medium tabular-nums">{value}</p>
      {caption ? <p className="text-muted-foreground mt-1 text-sm">{caption}</p> : null}
    </div>
  )
}
