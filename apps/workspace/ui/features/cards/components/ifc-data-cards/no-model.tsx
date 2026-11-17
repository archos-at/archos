'use client'

import type { JSX } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'

export function NoModel({
  isLoading = false,
  error = null,
  ambiguous = false,
  notReady = null,
}: {
  isLoading?: boolean
  error?: string | null
  ambiguous?: boolean
  notReady?: 'extracting' | 'failed' | null
} = {}): JSX.Element {
  const t = useTranslations(bimCopy)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-control border border-dashed p-6">
        <Spinner size="sm" />
      </div>
    )
  }
  return (
    <EmptyState
      title={
        error !== null
          ? t('preview.loadFailed')
          : ambiguous
            ? // "Not in this project" would be false: it is in the project
              t('card.ambiguousModel')
            : notReady === 'failed'
              ? // The one of these the reader can do something about.
                t('preview.extractionFailed')
              : notReady === 'extracting'
                ? t('preview.extracting')
                : t('card.noModel')
      }
    />
  )
}
