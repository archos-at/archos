'use client'

import type { JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'

export const TEMPORARY_LABEL = 'sessionsPanel.sessionLabelTemporary'

export function SessionTemporaryMark(): JSX.Element {
  const t = useTranslations(researchCopy)
  return (
    <span
      className="text-muted-foreground shrink-0"
      title={t('sessionsPanel.temporaryMark')}
      data-testid="session-temporary-mark"
    >
      <MessageCircleDashed className="size-3.5" aria-hidden="true" />
    </span>
  )
}
