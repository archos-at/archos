'use client'

import { useState, type FC } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { SectionLabel } from '@/components/ui/section-label'
import { PagePlaceButton } from '@/features/knowledge/components/page-place-button'
import type { PagePlace } from '@/features/knowledge/lib/page-place'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'
import type { AnswerCard } from '@/shared/cards/schemas'
import { CARD_SHELL } from './card-chrome'

type LookCardData = Extract<AnswerCard, { type: 'look' }>
type LookItem = LookCardData['items'][number]

interface LookCardProps {
  document: LookCardData['document']
  items: LookCardData['items']
  eager?: boolean
}

const THUMBNAIL_MAX_HEIGHT = 180

export const lookItemPlace = (document: LookCardData['document'], item: LookItem): PagePlace => ({
  document: { id: document.id ?? null, name: document.name, shelf: document.shelf ?? 'stored' },
  page: item.page,
  frame: item.frame ?? 'page',
  region: item.region ?? null,
  point: item.point ?? null,
  imageIndex: item.image_index ?? null,
  revisionId: item.revision_id ?? null,
  label: item.origin === 'reference' ? (item.label ?? null) : null,
})

export const lookItemColor = (shelf: 'stored' | 'base' | undefined, origin: LookItem['origin']): string =>
  origin === 'reference' ? 'var(--paper-ink)' : `var(--source-${shelf === 'base' ? 'law' : 'project'})`

const placeWords = (t: Translator, item: LookItem): string | null => {
  if (item.frame === 'image' && item.image_index != null) return t('cards.look.embeddedImage', { index: item.image_index + 1 })
  return item.where ?? (item.scope === 'overview' ? t('cards.look.wholePage') : null)
}

const hasExplanation = (item: LookItem): boolean => item.origin !== 'reference' && Boolean(item.question || item.reading)

const addressLine = (t: Translator, item: LookItem): string => {
  const place = placeWords(t, item)
  const page = t(item.origin === 'reference' ? 'cards.look.shown' : 'cards.look.looked', { page: item.page })
  return place ? `${page} · ${place}` : page
}

export const LookCard: FC<LookCardProps> = ({ document, items, eager }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)
  const explained = items.filter(hasExplanation)
  const hasReading = explained.some((item) => item.reading)

  return (
    <Card data-testid="look-card" className={cn(CARD_SHELL, 'gap-3 p-4 sm:p-5')}>
      <div className="flex flex-col gap-1">
        <SectionLabel>{t('cards.look.eyebrow')}</SectionLabel>
        <p className="card-title text-foreground break-all">{document.name}</p>
      </div>
      <ul className={cn('grid grid-cols-1 gap-3', items.length > 1 && 'sm:grid-cols-2')}>
        {items.map((item, index) => {
          const reference = item.origin === 'reference'
          return (
            <li key={index} data-testid="look-item" data-origin={item.origin ?? 'look'} className="min-w-0">
              <PagePlaceButton
                place={lookItemPlace(document, item)}
                color={lookItemColor(document.shelf, item.origin)}
                label={t('cards.look.open', { document: document.name, page: item.page })}
                thumbnailMaxHeight={THUMBNAIL_MAX_HEIGHT}
                eager={eager}
                className="w-full"
              >
                <span className="card-caption flex flex-col gap-0.5 px-0.5">
                  <span className="text-muted-foreground">{addressLine(t, item)}</span>
                  {reference && item.label && <span className="text-foreground">{item.label}</span>}
                </span>
              </PagePlaceButton>
            </li>
          )
        })}
      </ul>
      {explained.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid="look-explanation-trigger"
              className={cn(
                'card-caption text-muted-foreground hover:text-foreground touch-target flex origin-left items-center gap-1 rounded-control outline-none',
                PRESSABLE,
                FOCUS_RING
              )}
            >
              {t('cards.look.explanation')}
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
                  open && 'rotate-180'
                )}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent data-testid="look-explanation" className="duration-base ease-out">
            <ul className="card-caption flex flex-col gap-2 pt-2">
              {explained.map((item, index) => (
                <li key={index} className="flex flex-col gap-0.5">
                  {/* With one place the thumbnail above is the address; with more, each line says which. */}
                  {items.length > 1 && <span className="text-muted-foreground">{addressLine(t, item)}</span>}
                  {item.question && <span className="text-foreground">{item.question}</span>}
                  {item.reading && (
                    <Quote
                      as="span"
                      data-testid="look-reading"
                      title={t('cards.look.readingNote')}
                      className="text-foreground"
                    >
                      {t('cards.look.reading', { reading: item.reading })}
                    </Quote>
                  )}
                </li>
              ))}
            </ul>
            {hasReading && (
              <p data-testid="look-reading-note" className="card-caption text-muted-foreground pt-2">
                {t('cards.look.readingNote')}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  )
}
