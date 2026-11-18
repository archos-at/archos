'use client'

import type { JSX, ReactNode } from 'react'
import { Fragment } from 'react'
import { CheckCircle2, Clock, EyeOff } from 'lucide-react'

import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { formatRelativeTime } from '@/lib/format'
import type { InboxItemView } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import type { InboxDue } from '../lib/inbox-due'


export interface InboxItemCaptionProps {
  item: InboxItemView
  place: string | null
  openMarks: number
  due: InboxDue | null
  answered: boolean
}

export function InboxItemCaption({ item, place, openMarks, due, answered }: InboxItemCaptionProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const inert = item.state === 'inert'

  const parts: { key: string; node: ReactNode }[] = [
    {
      key: 'when',
      node: (
        <time className="shrink-0 tabular-nums sm:hidden" dateTime={item.updatedAt}>
          {formatRelativeTime(item.updatedAt, locale)}
        </time>
      ),
    },
    ...(item.projectName && !inert
      ? [{ key: 'project', node: <span className="min-w-0 truncate" data-testid="inbox-item-project">{item.projectName}</span> }]
      : []),
    ...(place ? [{ key: 'place', node: <span className="min-w-0 truncate" data-testid="inbox-item-place">{place}</span> }] : []),
    ...(due
      ? [{
          key: 'due',
          node: (
            <span
              data-testid="inbox-item-due"
              className={cn(
                'inline-flex shrink-0 items-center gap-1',
                due.variant === 'danger' && 'font-medium text-error',
                due.variant === 'warning' && 'font-medium text-warning',
              )}
            >
              <Clock className="size-3" aria-hidden />
              {due.label}
            </span>
          ),
        }]
      : []),
    ...(openMarks > 0
      ? [{ key: 'marks', node: <span className="shrink-0" data-testid="inbox-item-open-marks">{t('inbox.openMarks', { count: openMarks })}</span> }]
      : []),
    ...(answered
      ? [{
          key: 'answered',
          node: (
            <span className="inline-flex shrink-0 items-center gap-1 text-success">
              <CheckCircle2 className="size-3" aria-hidden />
              {t('inbox.resolved')}
            </span>
          ),
        }]
      : []),
    ...(inert
      ? [{
          key: 'inert',
          node: (
            <span className="inline-flex shrink-0 items-center gap-1">
              <EyeOff className="size-3" aria-hidden />
              {t('inbox.inert')}
            </span>
          ),
        }]
      : []),
  ]

  if (parts.length === 1) return <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{parts[0].node}</p>

  return (
    <p
      className="mt-0.5 flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
      data-testid="inbox-item-meta"
    >
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {/* The first separator follows the phone's moment, and goes with it. */}
          {index > 0 && <span aria-hidden className={cn('shrink-0', index === 1 && 'sm:hidden')}>·</span>}
          {part.node}
        </Fragment>
      ))}
    </p>
  )
}
