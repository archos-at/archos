'use client'

import type { FC } from 'react'
import { Lock } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'

export const RightsLostPanel: FC = () => {
  const t = useTranslations(collaborationCopy)
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4"
      data-testid="rights-lost"
    >
      <SectionLabel as="h2">{t('rightsLost.neutralTitle')}</SectionLabel>
      <EmptyState
        icon={Lock}
        tone="warning"
        title={t('rightsLost.title')}
        description={t('rightsLost.description')}
        className="max-w-md"
      />
    </div>
  )
}
