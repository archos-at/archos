import type { HTMLAttributes, JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function NoteList({ className, ...props }: HTMLAttributes<HTMLUListElement>): JSX.Element {
  return (
    <ul
      data-slot="note-list"
      className={cn('scroll-fade-bottom max-h-72 divide-y overflow-y-auto [scrollbar-color:var(--color-muted-foreground)_transparent] [&::-webkit-scrollbar-thumb]:bg-muted-foreground/60', className)}
      {...props}
    />
  )
}

export function NoteRow({
  icon: Icon,
  meta,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, 'children'> & {
  icon: LucideIcon
  meta?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <li data-slot="note-row" className={cn('flex gap-2.5 px-4 py-2.5', className)} {...props}>
      <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm leading-snug">{children}</p>
        {meta ? <div className="text-muted-foreground mt-1 text-xs">{meta}</div> : null}
      </div>
    </li>
  )
}

export function NoteMeta({ parts }: { parts: ReactNode[] }): JSX.Element {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </p>
  )
}

export function NotePanelTitle({
  icon: Icon,
  id,
  children,
}: {
  icon: LucideIcon
  id?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div data-slot="note-panel-title" className="flex items-center gap-2 border-b px-4 py-3">
      <Icon className="text-info size-4 shrink-0" aria-hidden="true" />
      <p id={id} className="text-sm font-medium">
        {children}
      </p>
    </div>
  )
}

export function NoteEmphasis({ children }: { children: ReactNode }): JSX.Element {
  return <span className="text-foreground font-medium">{children}</span>
}

export function NoteReplaced({
  label,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { label: ReactNode }): JSX.Element {
  return (
    <p className="mt-1" {...props}>
      {label} <del>{children}</del>
    </p>
  )
}

export function NotePanelHint({ id, children }: { id?: string; children: ReactNode }): JSX.Element {
  return (
    <div data-slot="note-panel-hint" className="border-t px-4 py-2.5">
      <p id={id} className="text-muted-foreground text-xs leading-relaxed">
        {children}
      </p>
    </div>
  )
}
