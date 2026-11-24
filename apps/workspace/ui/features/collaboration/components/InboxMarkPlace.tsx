'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { annotationBox, regionAround, type AnnotationView } from '@/lib/annotations/types'
import { PageRegionThumbnail } from '@/features/knowledge/components/page-region-thumbnail'
import type { PagePlace } from '@/features/knowledge/lib/page-place'
import { MarkBody } from '@/features/documents/components/review/mark-body'
import { cn } from '@/lib/utils'

const PLACE_MAX_HEIGHT = 280

export function markRegion(mark: Pick<AnnotationView, 'page' | 'x' | 'y' | 'w' | 'h' | 'points'>): [number, number, number, number] {
  const [x0, y0, x1, y1] = annotationBox(mark)
  if (x1 > x0 && y1 > y0) return [x0, y0, x1 - x0, y1 - y0]
  const around = regionAround(mark)
  return [around.x, around.y, around.w, around.h]
}

export function InboxMarkPlace({ mark, documentName, href }: { mark: AnnotationView; documentName: string; href: string }): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const sheet = t('inbox.page.sheet', { page: mark.page })
  if (!mark.onCurrentRevision) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="inbox-mark-elsewhere">
        {mark.revisionNumber === null ? t('inbox.page.earlierRevision') : t('inbox.page.onRevision', { revision: mark.revisionNumber })}
      </p>
    )
  }
  const place: PagePlace = {
    document: { id: mark.documentId, name: documentName, shelf: 'stored' },
    page: mark.page,
    frame: 'page',
    region: markRegion(mark),
  }
  return (
    <Link
      href={href}
      className={cn(
        'group/place border-base bg-card block overflow-hidden rounded-surface border outline-none',
        'hover:bg-sheet-hover focus-visible:ring-2 focus-visible:ring-ring/50'
      )}
      aria-label={t('inbox.page.openPlace', { sheet, number: mark.number })}
      data-testid="inbox-mark-place"
    >
      <PageRegionThumbnail place={place} lazy={false} maxHeight={PLACE_MAX_HEIGHT} label={sheet} fallback="none" className="bg-sheet" />
      <span className="text-muted-foreground flex items-center justify-between gap-3 border-t border-base px-3 py-2 text-xs">
        <span className="min-w-0 truncate">{[documentName, sheet].filter(Boolean).join(' · ')}</span>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 group-hover/place:text-foreground" />
      </span>
    </Link>
  )
}

export function InboxMarkThread({ mark, viewerId }: { mark: AnnotationView; viewerId: string | null }): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  if (mark.replies.length === 0) return null
  return (
    <ol className="flex flex-col gap-3" aria-label={t('inbox.page.thread')} data-testid="inbox-mark-thread">
      {mark.replies.map((reply) => (
        <li key={reply.id} className="flex flex-col gap-0.5" data-testid="inbox-mark-reply-entry">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">
              {reply.authorKind === 'person' ? (reply.createdByName ?? t('inbox.unknownActor')) : t('mentions.picker.agentName')}
            </span>
            {' · '}
            <time dateTime={reply.createdAt} title={formatAbsoluteTime(reply.createdAt, locale)}>
              {formatRelativeTime(reply.createdAt, locale)}
            </time>
          </p>
          <p className="text-foreground whitespace-pre-line text-sm leading-relaxed">
            <MarkBody text={reply.body} mentions={reply.mentions} viewerId={viewerId} />
          </p>
        </li>
      ))}
    </ol>
  )
}
