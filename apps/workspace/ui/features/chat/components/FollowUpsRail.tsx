'use client'

import { type FC, useMemo } from 'react'
import { PenLine } from 'lucide-react'
import { FadeIn } from '@/components/motion'
import {
  FollowUpChips,
  usableFollowUps,
  type FollowUpAction,
} from '@/features/cards/components/FollowUpChips'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { StoredFollowUp } from '@/lib/conversations/message-stages'

const NO_ITEMS: StoredFollowUp[] = []

interface FollowUpsRailProps {
  items?: StoredFollowUp[]
  offerFileNote?: boolean
  animateIn?: boolean
}

export const FollowUpsRail: FC<FollowUpsRailProps> = ({
  items = NO_ITEMS,
  offerFileNote = false,
  animateIn = true,
}) => {
  const t = useTranslations(chatCopy)
  const actions = useMemo<FollowUpAction[]>(
    () =>
      offerFileNote
        ? [
            {
              key: 'aktenvermerk',
              label: t('cards.followUps.fileNote'),
              prefill: t('cards.followUps.fileNotePrefill'),
              icon: PenLine,
            },
          ]
        : [],
    [offerFileNote, t]
  )

  if (usableFollowUps(items).length === 0 && actions.length === 0) return null

  return (
    <FadeIn
      distance={4}
      className="w-full"
      data-testid="follow-ups-rail"
      {...(animateIn ? {} : { initial: false as const })}
    >
      {/* No `mt-5`: inside the message column the parent's `gap-4` is the air,
          and a second margin would put the rail further from its answer than the
          answer is from the question. */}
      <FollowUpChips items={items} actions={actions} />
    </FadeIn>
  )
}
