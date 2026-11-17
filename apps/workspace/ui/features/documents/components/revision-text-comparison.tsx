'use client'

import type { JSX } from 'react'
import { AlertTriangle } from 'lucide-react'
import { FactLine } from '@/components/ui/fact-line'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { DocumentVersionDiff } from './document-version-diff'

export interface ComparedText {
  number: number
  content: string
}

export type TextComparison =
  | { rowKey: string; status: 'loading' }
  | { rowKey: string; status: 'failed' }
  | { rowKey: string; status: 'done'; from: ComparedText; to: ComparedText }

export function TextComparisonView({ comparison }: { comparison: TextComparison }): JSX.Element {
  const t = useTranslations(filesCopy)
  if (comparison.status === 'loading') {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs" role="status">
        <Spinner className="size-3.5" />
        {t('lifecycle.versions.comparing')}
      </p>
    )
  }
  if (comparison.status === 'failed') {
    return (
      <FactLine icon={AlertTriangle} tone="danger" testId="document-version-compare-failed">
        {t('lifecycle.versions.compareFailed')}
      </FactLine>
    )
  }
  return (
    <div data-testid="document-version-comparison">
      <DocumentVersionDiff
        from={{ versionNumber: comparison.from.number, content: comparison.from.content }}
        to={{ versionNumber: comparison.to.number, content: comparison.to.content }}
      />
    </div>
  )
}
