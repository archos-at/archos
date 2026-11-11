'use client'

/** The base corpus in four numbers, above its table: documents, indexed, sections, and what needs attention. */

import type { JSX } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Layers } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '@/components/ui/stat-card'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { isOibBinding } from '@/lib/knowledge/doc-class'
import type { KnowledgeBaseStatus, KnowledgeFile } from '@/lib/knowledge/service'

export function KnowledgeSummary({
  status,
  files,
  loading,
}: {
  status: KnowledgeBaseStatus | null
  files: readonly KnowledgeFile[]
  loading: boolean
}): JSX.Element | null {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    )
  }
  if (!status) return null
  const { summary } = status
  const n = (value: number): string => value.toLocaleString(locale)
  const binding = files.filter((f) => isOibBinding(f.docClass)).length
  const issues = summary.failed + summary.inconsistent + summary.stale + summary.removed
  const pct = summary.totalFiles > 0 ? Math.round((summary.ingested / summary.totalFiles) * 100) : 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="knowledge-summary">
      <StatCard
        icon={<FileText aria-hidden />}
        label={t('knowledgeAdmin.summaryDocuments')}
        value={n(summary.totalFiles)}
        hint={t('knowledgeAdmin.summaryDocumentsHint', { count: n(binding) })}
      />
      <StatCard
        icon={<CheckCircle2 aria-hidden />}
        label={t('knowledgeAdmin.summaryIndexed')}
        value={n(summary.ingested)}
        hint={
          summary.pending > 0
            ? t('knowledgeAdmin.summaryIndexedPending', { count: n(summary.pending) })
            : t('knowledgeAdmin.summaryIndexedHint', { pct: n(pct) })
        }
      />
      <StatCard
        icon={<Layers aria-hidden />}
        label={t('knowledgeAdmin.summaryChunks')}
        value={n(summary.totalChunks)}
        hint={t('knowledgeAdmin.summaryChunksHint')}
      />
      <StatCard
        icon={<AlertTriangle aria-hidden />}
        label={t('knowledgeAdmin.summaryIssues')}
        value={n(issues)}
        hint={
          issues > 0 ? t('knowledgeAdmin.summaryIssuesHint') : t('knowledgeAdmin.summaryIssuesNone')
        }
        data-testid="knowledge-summary-issues"
      />
    </div>
  )
}
