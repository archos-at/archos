'use client'

import type { FC } from 'react'
import { PagePlaceButton } from '@/features/knowledge/components/page-place-button'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { LookStepGroup, LookStepPlace } from '../../lib/look-steps'
import { regionWords } from '../../lib/work-sentence'

export const STRIP_WIDTH = 132
export const STRIP_MAX_HEIGHT = 96

const colorOf = (group: LookStepGroup): string =>
  `var(--source-${group.document.shelf === 'base' ? 'law' : 'project'})`

export const placeLine = (t: Translator, look: LookStepPlace): string =>
  look.where
    ? t('thinking.look.place', { page: look.place.page, where: regionWords(t, look.where) })
    : t('thinking.look.placeWhole', { page: look.place.page })

export const LookStrip: FC<{ group: LookStepGroup; eager?: boolean; className?: string }> = ({
  group,
  eager,
  className,
}) => {
  const t = useTranslations(chatCopy)
  const color = colorOf(group)
  return (
    <div className={className ?? 'flex gap-2 overflow-x-auto pb-1 pl-5'}>
      {group.looks.map((look) => (
        <PagePlaceButton
          key={look.id}
          place={look.place}
          color={color}
          label={t('cards.look.open', { document: group.document.name, page: look.place.page })}
          thumbnailWidth={STRIP_WIDTH}
          thumbnailMaxHeight={STRIP_MAX_HEIGHT}
          eager={eager}
          className="shrink-0"
        >
          {group.looks.length > 1 && (
            <span className="text-muted-foreground max-w-[132px] truncate px-0.5 text-xs">
              {placeLine(t, look)}
            </span>
          )}
        </PagePlaceButton>
      ))}
    </div>
  )
}
