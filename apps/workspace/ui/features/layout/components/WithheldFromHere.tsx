'use client'

import type { FC } from 'react'
import { Lock } from 'lucide-react'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'

export const WithheldFromHere: FC = () => {
  const t = useTranslations(collaborationCopy)
  return (
    <p
      role="note"
      className="text-muted-foreground mx-auto flex max-w-2xl items-center gap-2 px-4 pb-4 text-sm"
      data-testid="withheld-from-here"
    >
      <Lock aria-hidden className="size-4 shrink-0" />
      {t('rightsLost.withheldFrom')}
    </p>
  )
}
