'use client'

import type { ComponentProps, JSX, ReactNode } from 'react'
import { MoreHorizontal, Sparkles } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { DEFAULT_TAIL_LENGTH } from '@/lib/text/middle-truncate'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import { changeLines } from '@/lib/documents/revision-timeline'

export interface RevisionTimelineRowProps {
  label: string
  tag?: string | null
  marker?: string | null
  badge?: ReactNode
  newest?: boolean
  filename?: string | null
  filenameTail?: number
  acts?: readonly string[]
  comment?: string | null
  changeCaption?: string | null
  change?: string | null
  changeHint?: string | null
  changeTestId?: string
  action?: ReactNode
  menu?: readonly ActionMenuEntry[]
  menuLabel?: string
  children?: ReactNode
  last?: boolean
  dataset?: Readonly<Record<string, string | undefined>>
}

export function RevisionTimelineRow({
  label,
  tag,
  marker,
  badge,
  newest = false,
  filename,
  filenameTail = DEFAULT_TAIL_LENGTH,
  acts = [],
  comment,
  changeCaption,
  change,
  changeHint,
  changeTestId = 'revision-row-change',
  action,
  menu = [],
  menuLabel,
  children,
  last = false,
  dataset = {},
}: RevisionTimelineRowProps): JSX.Element {
  const data = Object.fromEntries(Object.entries(dataset).map(([key, value]) => [`data-${key}`, value]))
  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0" data-testid="revision-timeline-row" {...data}>
      <span aria-hidden className="relative flex w-2 shrink-0 justify-center">
        <span className={cn('mt-1.5 size-2 rounded-full', newest ? 'bg-foreground' : 'bg-muted-foreground/50')} />
        {/* Dot to dot: from under this one, through the row's padding, to the top of the next. */}
        {!last && <span className="bg-border absolute top-3.5 -bottom-[18px] w-px" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1">
          <p className="text-foreground flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug">
            <span className="font-medium whitespace-nowrap" data-testid="revision-row-label">
              {label}
            </span>
            {marker && (
              <Badge variant="secondary" className="bg-background px-1.5 py-0 text-[11px]" data-testid="revision-row-current">
                {marker}
              </Badge>
            )}
            {badge}
            {/* Last, so a crowded line wraps the tag, not the marker. */}
            {tag && (
              <span className="text-muted-foreground text-xs whitespace-nowrap" data-testid="revision-row-tag">
                {tag}
              </span>
            )}
          </p>
          {/* The one visible action, on the title line: a row of its own per
              Fassung was a fifth of the timeline's height. */}
          {action && <span className="-my-0.5 flex shrink-0 items-center">{action}</span>}
          {menu.length > 0 && (
            <ActionMenu
              mode="dropdown"
              entries={menu}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground -my-1 size-6 shrink-0"
                  aria-label={menuLabel}
                  title={menuLabel}
                  data-testid="revision-row-menu"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              }
            />
          )}
        </div>
        {filename && <MiddleTruncate text={filename} tail={filenameTail} className="text-muted-foreground text-xs" />}
        {acts.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {acts.map((act) => (
              <p key={act} className="text-muted-foreground text-xs leading-snug" data-testid="revision-row-act">
                {act}
              </p>
            ))}
          </div>
        )}
        {comment && (
          <Quote as="p" className="text-xs leading-[1.5]" data-testid="document-version-comment">
            {comment}
          </Quote>
        )}
        {change && (
          <div className="flex flex-col gap-1" data-testid={changeTestId}>
            {changeCaption && <p className="text-muted-foreground text-xs">{changeCaption}</p>}
            <ChangeList text={change} />
            {changeHint && (
              <p className="text-muted-foreground flex gap-1 text-[11px] leading-snug" data-testid="revision-change-hint">
                <Sparkles className="mt-px size-3 shrink-0" aria-hidden />
                <span>{changeHint}</span>
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </li>
  )
}

function ChangeList({ text }: { text: string }): JSX.Element {
  return (
    <ul className="text-foreground flex flex-col gap-0.5 text-xs leading-snug">
      {changeLines(text).map((line, index) => (
        <li key={index} className="before:text-muted-foreground flex gap-1.5 before:content-['–']">
          {line}
        </li>
      ))}
    </ul>
  )
}

export function RowAction({
  children,
  asChild,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'className'>): JSX.Element {
  return (
    <Button
      type={asChild ? undefined : 'button'}
      asChild={asChild}
      variant="link"
      size="sm"
      className="text-muted-foreground hover:text-foreground touch-target h-auto px-1 py-0.5 text-xs pointer-coarse:h-auto"
      {...props}
    >
      {children}
    </Button>
  )
}
