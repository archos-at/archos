'use client'

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes, type JSX, type ReactNode, type SyntheticEvent } from 'react'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from './button'
import { AgentGlyph } from './agent-glyph'
import { PopoverContent } from './popover'

export function SuggestionPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      role="group"
      data-slot="suggestion-panel"
      className={cn('bg-card grid grid-cols-1 gap-0.5 rounded-surface border p-1.5', className)}
      {...props}
    />
  )
}

export function SuggestionPanelHeader({ id, children }: { id?: string; children: ReactNode }): JSX.Element {
  return (
    <div data-slot="suggestion-panel-header" className="flex items-center gap-2 px-2 pb-1 pt-1.5">
      <AgentGlyph size="xs" className="size-4" />
      <p id={id} className="text-foreground min-w-0 text-xs font-medium">
        {children}
      </p>
    </div>
  )
}

export function SuggestionPanelLine({
  active = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { active?: boolean }): JSX.Element {
  return (
    <div
      data-slot="suggestion-panel-line"
      data-active={active || undefined}
      className={cn(
        'data-[active]:bg-accent flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control px-2 py-1.5 text-xs',
        'transition-colors duration-snap ease-out motion-reduce:transition-none',
        className
      )}
      {...props}
    />
  )
}

export function SuggestionPanelSubject({
  name,
  mark,
  count,
  detail,
  detailTitle,
}: {
  name: ReactNode
  mark?: ReactNode
  count?: ReactNode
  detail?: ReactNode
  detailTitle?: string
}): JSX.Element {
  return (
    <div className="min-w-0 flex-[1_1_14rem]">
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-foreground min-w-0 font-medium [overflow-wrap:anywhere]">{name}</span>
        {mark}
        {count !== undefined && <span className="text-muted-foreground whitespace-nowrap tabular-nums">{count}</span>}
      </p>
      {detail && (
        <p className="text-muted-foreground mt-0.5 truncate" title={detailTitle}>
          {detail}
        </p>
      )}
    </div>
  )
}

export function SuggestionActions({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1', className)} {...props} />
}

export const SuggestionButton = forwardRef<HTMLButtonElement, ButtonProps>(function SuggestionButton(
  { className, size = 'sm', type = 'button', ...props },
  ref
) {
  return <Button ref={ref} type={type} size={size} className={cn('h-7 px-2.5', className)} {...props} />
})

export function SuggestionReason({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): JSX.Element {
  return <p className={cn('text-muted-foreground line-clamp-3 text-xs leading-snug', className)} {...props} />
}

export function SuggestionNote({
  tone = 'muted',
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: 'muted' | 'default' | 'error' }): JSX.Element {
  return (
    <p
      className={cn(
        'text-xs leading-snug',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'default' && 'text-foreground',
        tone === 'error' && 'text-destructive',
        className
      )}
      {...props}
    />
  )
}

const stop = (event: SyntheticEvent) => event.stopPropagation()

export const SuggestionPopoverContent = forwardRef<
  ElementRef<typeof PopoverContent>,
  ComponentPropsWithoutRef<typeof PopoverContent>
>(function SuggestionPopoverContent({ className, align = 'start', ...props }, ref) {
  return (
    <PopoverContent
      ref={ref}
      align={align}
      collisionPadding={16}
      className={cn('grid w-72 max-w-[calc(100vw-2rem)] grid-cols-1 gap-2.5 p-3 text-xs', className)}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
      onContextMenu={stop}
      {...props}
    />
  )
})
