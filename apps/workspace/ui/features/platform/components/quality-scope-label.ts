'use client'

import { useCallback } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { formatDayRange } from '@/lib/format'
import type { QualityScope } from '@/lib/quality/scope'

export function useQualityScopeLabel(): (scope: QualityScope) => string {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  return useCallback(
    (scope: QualityScope) =>
      [
        formatDayRange(scope.from, scope.to, locale),
        scope.organizationIds.length > 0
          ? t('citations.scopeLabel.organizations', { count: scope.organizationIds.length })
          : null,
        scope.projectIds.length > 0
          ? t('citations.scopeLabel.projects', { count: scope.projectIds.length })
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [locale, t]
  )
}
