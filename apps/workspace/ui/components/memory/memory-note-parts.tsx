'use client'

/**
 * The parts of a list of memory notes on a page: the row, its text, its
 * editor, its actions and the loading rows. Domain-free on purpose: the
 * project's memory (`project-memory-panel.tsx`) and a person's own
 * (`personal-memory-panel.tsx`) are two stores with two audiences (ADR-0180),
 * and they must look and behave as one kind of list. Labels come from the
 * caller, which knows its namespace.
 */

import type { ComponentProps, JSX, ReactNode } from 'react'
import { Pin, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemList } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * One note's row. A phone stacks the note over its actions: beside the text,
 * four 44px buttons left the note about 130px, a column of one word per line;
 * beneath it the note has the full width and the buttons keep their size.
 */
export function MemoryNoteItem({ className, ...props }: ComponentProps<typeof Item>): JSX.Element {
  return (
    <Item
      className={cn('group flex-col items-stretch gap-1 sm:flex-row sm:items-start sm:gap-3', className)}
      {...props}
    />
  )
}

/** The note itself, with the pin glyph in front of a pinned one. */
export function MemoryNoteText({
  pinned,
  pinnedLabel,
  children,
}: {
  pinned: boolean
  pinnedLabel: string
  children: ReactNode
}): JSX.Element {
  return (
    <p className="flex items-start gap-1.5 text-sm leading-relaxed">
      {pinned && <Pin className="text-muted-foreground mt-1 size-3 shrink-0" aria-label={pinnedLabel} />}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}

export interface MemoryNoteEditorProps {
  /** The textarea's id; the label points at it. */
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
  saveLabel: string
  cancelLabel: string
  /** Why the last save was refused (another note already says it), under the field. */
  error?: string | null
  maxLength?: number
}

/** A note being rewritten in place: Escape leaves, the buttons say the rest. */
export function MemoryNoteEditor({
  id,
  label,
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  saveLabel,
  cancelLabel,
  error = null,
  maxLength,
}: MemoryNoteEditorProps): JSX.Element {
  const errorId = `${id}-error`
  return (
    <div className="space-y-2">
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
          rows={2}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoFocus
        />
      </Field>
      {error && (
        <p id={errorId} role="alert" className="text-foreground text-xs font-medium">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={busy || value.trim().length === 0}>
          {saveLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * A row's actions. Quiet until the row is pointed at or holds focus; always
 * there under a finger and under reduced motion.
 */
export function MemoryNoteActions({ className, ...props }: ComponentProps<typeof ItemActions>): JSX.Element {
  return (
    <ItemActions
      className={cn(
        'duration-quick pointer-coarse:opacity-100 -mr-2 gap-1 opacity-0 max-sm:justify-end sm:mr-0 transition-opacity ease-out focus-within:opacity-100 group-hover:opacity-100 motion-reduce:opacity-100 motion-reduce:transition-none',
        className
      )}
      {...props}
    />
  )
}

/** One of a row's actions: a glyph with its name for assistive technology and its consequence on hover. */
export function MemoryNoteAction({
  icon: Icon,
  label,
  title,
  onClick,
  disabled = false,
  destructive = false,
}: {
  icon: LucideIcon
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('text-muted-foreground size-7', destructive ? 'hover:text-destructive' : 'hover:text-foreground')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
    >
      <Icon className="size-3.5" aria-hidden />
    </Button>
  )
}

/** Three rows in the list's own shape while the notes are on their way. */
export function MemoryListSkeleton(): JSX.Element {
  return (
    <ItemList data-testid="memory-list-loading">
      {Array.from({ length: 3 }).map((_, index) => (
        <Item key={index}>
          <ItemContent className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-40" />
          </ItemContent>
        </Item>
      ))}
    </ItemList>
  )
}
