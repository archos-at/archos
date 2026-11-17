'use client'

import { CLAUSE_JOIN } from '@/lib/format'
import type { JSX, SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareText } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n/translate'
import { filesCopy } from '@/i18n/namespaces/files'
import type { MarkTally } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import { reviewHrefAt } from '../lib/open-review'

export interface OpenMarksSubject {
  id: string
  marks?: MarkTally | null
}

export type MarkCounts = Pick<MarkTally, 'open' | 'proposed'> & { forYou?: number }

export const hasLiveMarks = (marks: MarkCounts): boolean => marks.open + marks.proposed > 0

export function openMarksLabel(t: Translator, locale: string, marks: MarkCounts): string {
  const forYou = marks.forYou ?? 0
  const parts = [
    marks.open > 0
      ? forYou > 0
        ? t('annotations.listedOpenForYou', { count: marks.open, mine: forYou })
        : t('annotations.listedOpen', { count: marks.open })
      : null,
    marks.proposed > 0 ? t('review.proposalsGroup', { count: marks.proposed }) : null,
  ].filter((part): part is string => part !== null)
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
}

function openMarksShortParts(t: Translator, marks: MarkCounts): string[] {
  const forYou = marks.forYou ?? 0
  return [
    marks.open > 0
      ? forYou > 0
        ? t('annotations.listedOpenShortForYou', { count: marks.open, mine: forYou })
        : t('annotations.listedOpenShort', { count: marks.open })
      : null,
    marks.proposed > 0 ? t('annotations.listedProposedShort', { count: marks.proposed }) : null,
  ].filter((part): part is string => part !== null)
}

export function openMarksShortLabel(t: Translator, marks: MarkCounts): string {
  return openMarksShortParts(t, marks).join(CLAUSE_JOIN)
}

const keep = (event: SyntheticEvent) => event.stopPropagation()

export function OpenMarksChip({
  file,
  name,
  className,
}: {
  file: OpenMarksSubject
  name: string
  className?: string
}): JSX.Element | null {
  if (!file.marks || !hasLiveMarks(file.marks)) return null
  return <OpenMarksButton documentId={file.id} name={name} marks={file.marks} className={className} />
}

function OpenMarksButton({
  documentId,
  name,
  marks,
  className,
}: {
  documentId: string
  name: string
  marks: MarkTally
  className?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const label = openMarksLabel(t, locale, marks)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip asChild interactive size="sm" variant="muted" className={cn('max-w-full min-w-0 tabular-nums', className)}>
          <button data-attr="open-marks"
            type="button"
            data-slot="open-marks"
            data-testid="open-marks"
            aria-label={t('annotations.listedOpenIn', { marks: label, name })}
            onPointerDown={keep}
            onKeyDown={keep}
            onClick={(event) => {
              keep(event)
              router.push(reviewHrefAt(window.location, { documentId }, { withDocument: true }), { scroll: false })
            }}
          >
            <MessageSquareText aria-hidden />
            {/* Below 640px a clause after the first is dropped whole, never cut mid-word („3 …“ on a 156px tile);
                the name says the whole sentence, the tooltip too. */}
            <span className="min-w-0 truncate">
              {openMarksShortParts(t, marks).map((part, index) => (
                <span key={part} className={cn(index > 0 && 'max-sm:hidden')}>
                  {index > 0 && CLAUSE_JOIN}
                  {part}
                </span>
              ))}
            </span>
          </button>
        </Chip>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
