'use client'

import type { JSX } from 'react'
import { useEffect } from 'react'
import { FileSearch } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { dossierCopy } from '@/i18n/namespaces/dossier'
import { COVERAGE_REASONS } from '@/lib/documents/dossier'
import type { DocumentFinding, FindingSource } from '@/lib/documents/findings'
import type { DocumentFindingsResponse } from '@/lib/documents/findings-wire'
import type { ProfileComparedKey } from '@/lib/documents/profile-contradictions'
import { DocumentLink, pagesLabel, ProjectProfileLink } from './document-dossier'

type Translate = ReturnType<typeof useTranslations>

export const DOCUMENT_FINDINGS_ANCHOR = 'document-findings'

export function profileSubjectLabel(t: Translate, subject: ProfileComparedKey): string {
  return subject === 'federal_state' ? t('findings.federalState') : t(`factKeys.${subject}`)
}

function profileValueText(t: Translate, finding: Extract<DocumentFinding, { kind: 'profile_contradiction' }>): string {
  return finding.subject === 'building_class'
    ? t('findings.buildingClassValue', { value: finding.profileValue })
    : finding.profileValue
}

function findingText(t: Translate, finding: DocumentFinding): string {
  switch (finding.kind) {
    case 'profile_contradiction':
      return t('findings.profileContradiction', { fact: profileSubjectLabel(t, finding.subject) })
    case 'contradiction':
      return t('findings.contradiction', { fact: t(`factKeys.${finding.factKey}`) })
    case 'missing_document':
      return t('findings.missingDocument', { label: t(`documentTypes.${finding.documentType}`) })
    case 'missing_plan':
      return t('findings.missingPlan', { label: finding.label })
    case 'incomplete_read': {
      const reasons = COVERAGE_REASONS.filter((reason) => (finding.reasons[reason] ?? 0) > 0)
        .map((reason) => t(`coverageReasons.${reason}`))
        .join(', ')
      const text = t('findings.incompleteRead', { notRead: finding.notRead, pages: finding.pages })
      return reasons ? `${text} (${reasons})` : text
    }
  }
}

function SourceItem({ source, projectId }: { source: FindingSource; projectId: string }): JSX.Element {
  const t = useTranslations(dossierCopy)
  const pages = pagesLabel(t, source.pages)
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="text-foreground min-w-0">
        <DocumentLink projectId={projectId} document={source} />
        {source.value !== undefined && `: ${source.unit ? `${source.value} ${source.unit}` : source.value}`}
      </span>
      {pages && <span className="text-muted-foreground tabular-nums">({pages})</span>}
    </span>
  )
}

function FindingLine({ finding, projectId }: { finding: DocumentFinding; projectId: string }): JSX.Element {
  const t = useTranslations(dossierCopy)
  return (
    <li className="flex items-start gap-2" data-testid={`finding-${finding.kind}`}>
      <FileSearch className="text-foreground mt-[3px] size-3.5 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-foreground text-[13px] leading-snug [overflow-wrap:anywhere]">{findingText(t, finding)}</span>
      <span className="text-meta text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]">
        {(finding.kind === 'missing_document' || finding.kind === 'missing_plan') && <span>{t('findings.referredIn')}</span>}
        {finding.kind === 'profile_contradiction' && (
          <span className="text-foreground" data-testid="finding-profile-value">
            <ProjectProfileLink projectId={projectId}>{t('findings.profile')}</ProjectProfileLink>
            {`: ${profileValueText(t, finding)}`}
            <span className="text-muted-foreground" aria-hidden>
              {' ·'}
            </span>
          </span>
        )}
        {finding.sources.map((source, index) => (
          <SourceItem key={`${source.documentId}-${index}`} source={source} projectId={projectId} />
        ))}
      </span>
      </span>
    </li>
  )
}

export function DocumentFindingsSection({
  projectId,
  response,
}: {
  projectId: string
  response: DocumentFindingsResponse
}): JSX.Element | null {
  const t = useTranslations(dossierCopy)
  const { findings } = response
  if (findings.length === 0) return null
  return (
    <section
      id={DOCUMENT_FINDINGS_ANCHOR}
      aria-labelledby="document-findings-title"
      className="flex scroll-mt-4 flex-col gap-1 px-4 pb-3 pt-2"
      data-testid="document-findings-panel"
    >
      <h3 id="document-findings-title" className="text-foreground text-name font-semibold">
        {t('findings.title')}
      </h3>
      <p className="text-meta text-muted-foreground">{t('findings.hint')}</p>
      <ul className="mt-1 flex flex-col gap-2">
        {findings.map((finding, index) => (
          <FindingLine key={`${finding.kind}-${index}`} finding={finding} projectId={projectId} />
        ))}
      </ul>
      {response.truncated && <p className="text-meta text-muted-foreground">{t('findings.truncated', { count: response.documentCount })}</p>}
    </section>
  )
}

export function useOpenOnFindingsLink(shown: boolean, collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void): void {
  useEffect(() => {
    if (!shown || window.location.hash !== `#${DOCUMENT_FINDINGS_ANCHOR}`) return
    if (collapsed) {
      onCollapsedChange(false)
      return
    }
    document.getElementById(DOCUMENT_FINDINGS_ANCHOR)?.scrollIntoView({ block: 'start' })
  }, [shown, collapsed, onCollapsedChange])
}
