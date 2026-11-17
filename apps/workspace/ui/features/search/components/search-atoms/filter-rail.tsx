'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'

export function FilterSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  clearLabel,
  onClear,
  canClear,
  showLabel,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  closeLabel: string
  clearLabel: string
  onClear: () => void
  canClear: boolean
  showLabel: string
  children: ReactNode
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel} data-testid="search-filter-sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex min-w-0 flex-col gap-1" data-testid="search-rail">
          {children}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClear} disabled={!canClear} data-testid="search-sheet-clear">
            {clearLabel}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)} data-testid="search-sheet-show">
            {showLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RailSection({
  title,
  children,
  testId,
  defaultOpen = true,
  fixed = false,
}: {
  title: string
  children: ReactNode
  testId?: string
  defaultOpen?: boolean
  fixed?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  if (fixed) {
    return (
      <section className="flex min-w-0 flex-col border-b border-border/60 py-2 last:border-b-0" data-testid={testId}>
        <div className="flex h-7 items-center px-1">
          <SectionLabel as="h3">{title}</SectionLabel>
        </div>
        <div className="flex min-w-0 flex-col pt-0.5">{children}</div>
      </section>
    )
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="flex min-w-0 flex-col border-b border-border/60 py-2 last:border-b-0" data-testid={testId}>
        <CollapsibleTrigger
          className={cn('group flex h-7 w-full items-center gap-1 rounded-sm px-1 text-left', FOCUS_RING_INSET)}
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <ChevronRight
            className="size-3 shrink-0 text-muted-foreground transition-transform duration-quick ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            aria-hidden
          />
          <SectionLabel as="h3">{title}</SectionLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col pt-0.5">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

export function FacetOption({
  label,
  count,
  active,
  onToggle,
  testId,
}: {
  label: string
  count: number
  active: boolean
  onToggle: () => void
  testId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        'flex min-h-7 w-full min-w-0 items-start gap-2 rounded-sm px-1 py-1 text-left text-sm leading-5 transition-colors duration-snap ease-out motion-reduce:transition-none pointer-coarse:min-h-11 pointer-coarse:items-center',
        FOCUS_RING_INSET,
        active ? 'bg-secondary font-medium text-foreground' : 'text-foreground/80 hover:bg-hover hover:text-foreground'
      )}
    >
      <span
        className={cn(
          'mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-snap pointer-coarse:mt-0',
          active ? 'border-foreground bg-foreground text-background' : 'border-strong bg-background'
        )}
        aria-hidden
      >
        {active ? (
          <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5 5 9l4.5-5.5" />
          </svg>
        ) : null}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words" title={label.length > 48 ? label : undefined}>
        {label}
      </span>
      <span className="shrink-0 text-xs leading-5 tabular-nums text-muted-foreground">{count}</span>
    </button>
  )
}

export function FacetFind({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-1 pb-1.5 pointer-fine:[&_input]:h-8">{children}</div>
}

export function RailAction({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">{children}</div>
}

export function RailBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-3 px-1 pb-2 pt-1 pointer-fine:[&_input]:h-8">{children}</div>
}

export function FieldStack({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-2">{children}</div>
}

export function KeyFieldRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem] items-start gap-2">{children}</div>
}

export function FieldPair({ children }: { children: ReactNode }): JSX.Element {
  return <div className="grid min-w-0 grid-cols-2 gap-2">{children}</div>
}
