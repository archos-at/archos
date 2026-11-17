'use client'

import type { JSX } from 'react'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ViewerSurface } from './viewer-surface'
import { ViewerSectionHeader } from './viewer-panel'

export interface ViewerRailProps {
  children: ReactNode
  className?: string
}

export function ViewerRail({ children, className }: ViewerRailProps): JSX.Element {
  return (
    <ViewerSurface
      className={cn(
        'scroll-fade-bottom flex max-h-[calc(100%-1.5rem)] w-52 flex-col overflow-y-auto overscroll-contain',
        'animate-in fade-in-0 slide-in-from-left-2 duration-base ease-entrance motion-reduce:animate-none',
        className
      )}
    >
      {children}
    </ViewerSurface>
  )
}

export interface ViewerRailSectionProps {
  label: string
  action?: ReactNode
  children: ReactNode
}

export function ViewerRailSection({ label, action, children }: ViewerRailSectionProps): JSX.Element {
  return (
    <section aria-label={label} className="border-border shrink-0 border-b last:border-b-0">
      <ViewerSectionHeader className="justify-between">
        {/*
          Sentence case, not uppercase. Shouted micro-labels are a habit from
          dashboards, and this rail is a list of buildings and floors — the
          reference this design follows labels the same thing "Models" and
          "Layers", quietly.
        */}
        <h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
        {action}
      </ViewerSectionHeader>
      <div className="px-1.5 pb-2">{children}</div>
    </section>
  )
}

export interface ViewerRailItemProps {
  label: string
  meta?: ReactNode
  icon?: ReactNode
  selected?: boolean
  toggle?: boolean
  disabled?: boolean
  onClick?: () => void
  ariaLabel?: string
  'data-testid'?: string
}

export function ViewerRailItem({
  label,
  meta,
  icon,
  selected = false,
  toggle = true,
  disabled = false,
  onClick,
  ariaLabel,
  ...rest
}: ViewerRailItemProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={toggle ? selected : undefined}
      aria-label={ariaLabel}
      title={label}
      data-testid={rest['data-testid']}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium',
        'transition-colors duration-quick ease-out',
        'focus-visible:ring-ring/60 outline-none focus-visible:ring-2',
        'pointer-coarse:min-h-11 pointer-coarse:py-2.5',
        selected ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      {icon && <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>}
      {/*
        Two lines under a finger instead of one clipped one. `title` is the
        only other place the full name lives, and it needs a hover — so a
        storey called "02 Obergeschoss (Wohnen, Süd)" ended in an ellipsis that
        a phone could not expand.
      */}
      <span className="min-w-0 flex-1 truncate pointer-coarse:line-clamp-2 pointer-coarse:break-words pointer-coarse:whitespace-normal">
        {label}
      </span>
      {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </button>
  )
}
