'use client'

/**
 * „Befunde aus den Dokumenten“: what a project's documents say about each
 * other, in the folder brief at the root of a project's files — a contradiction between two of them,
 * a document or drawing number one points at that the project does not hold,
 * a document Piloti could not read in full (`lib/documents/findings.ts`).
 *
 * A section of the folder brief at the root, one row per finding with the
 * documents it rests on as links, and absent when there is nothing to say: an
 * empty section would be a claim that the documents were checked against each
 * other and found clean, which nobody made.
 */

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

/** The id the panel carries, so the inbox's upload report can link straight to it. */
export const DOCUMENT_FINDINGS_ANCHOR = 'document-findings'

/** What a profile contradiction is about: a fact key's label, or the Land. */
export function profileSubjectLabel(t: Translate, subject: ProfileComparedKey): string {
  return subject === 'federal_state' ? t('findings.federalState') : t(`factKeys.${subject}`)
}

/** The Steckbrief's value as the line shows it: the Gebäudeklasse with its „GK“. */
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

/** One document a finding rests on: its link, the value it states, the pages. */
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

/**
 * The findings as a section of the folder brief at the shelf's root (`FolderBrief`): what {productName} found beside
 * what it read, one block on the listing's column instead of a second bordered strip across the page (dev,
 * 2026-11-10: the panel ran from the page's left edge to its right, over a brief on the 1280px column). The brief's
 * folded line counts them; open, this is its section, a heading by weight over one row per finding, each a sentence
 * and the documents it rests on. Ink, no hue: a finding is a pointer to check, not a verdict (principle 7).
 */
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
      <h3 id="document-findings-title" className="text-foreground text-name font-medium">
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

/**
 * The inbox's upload report links to `#document-findings`: the brief opens, and the findings come into view once
 * they are drawn (they arrive after the page, so the browser's own jump to the anchor misses them).
 */
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
