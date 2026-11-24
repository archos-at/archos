'use client'

import NextLink from 'next/link'
import { History, Link2 } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isGhostMark, type AnnotationView } from '@/lib/annotations/types'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { otherReviewHref } from '../../../lib/revision-links'

export function RevisionLines({
  review,
  annotation,
  busy,
  onCarry,
}: {
  review: DocumentReview
  annotation: AnnotationView
  busy: boolean
  onCarry: () => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const replacedBy = review.revision?.replacedBy ?? null
  const target = annotation.carryTarget ?? null
  const earlier = !annotation.onCurrentRevision
  const where = typeof window === 'undefined' ? null : window.location
  const linkTo = (link: { documentId: string; annotationId: string }) =>
    where ? otherReviewHref(where, review.documentId, link) : null
  const lines: JSX.Element[] = []
  if (earlier || (replacedBy && target)) {
    lines.push(
      <div key="revision" className="flex flex-col gap-1.5" data-testid="thread-earlier">
        <p className="flex items-start gap-1.5">
          <History className="mt-px size-3 shrink-0" aria-hidden />
          {earlier
            ? annotation.revisionNumber
              ? // An open one is drawn as a ghost where it stood; a closed one is not drawn.
                t(isGhostMark(annotation, review.documentId) ? 'review.earlierRevisionGhost' : 'review.earlierRevision', {
                  number: annotation.revisionNumber,
                })
              : t('annotations.earlierRevisionUnnumbered')
            : t('review.replacedNotice', { name: replacedBy?.filename ?? '' })}
        </p>
        {target && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 self-start text-xs"
            disabled={busy}
            data-testid="thread-carry"
            onClick={onCarry}
          >
            {target.documentId === annotation.documentId
              ? t('review.carry')
              : t('review.carryTo', { name: target.documentName })}
          </Button>
        )}
      </div>
    )
  }
  for (const [key, link, words] of [
    ['from', annotation.carriedFrom, 'review.carriedFrom'],
    ['to', annotation.carriedTo, 'review.carriedTo'],
  ] as const) {
    if (!link) continue
    const text = t(words, { name: link.documentName, number: link.number })
    const href = linkTo(link)
    lines.push(
      <p key={key} className="flex items-start gap-1.5" data-testid={`thread-carried-${key}`}>
        <Link2 className="mt-px size-3 shrink-0" aria-hidden />
        {href ? (
          <NextLink href={href} replace className="hover:text-foreground underline underline-offset-2">
            {text}
          </NextLink>
        ) : (
          text
        )}
      </p>
    )
  }
  if (lines.length === 0) return null
  return (
    <div className="text-muted-foreground bg-muted space-y-1 border-b px-3 py-1.5 text-[11px] leading-4">{lines}</div>
  )
}
