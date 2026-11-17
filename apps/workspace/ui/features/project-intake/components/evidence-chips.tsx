'use client'

import type { JSX } from 'react'
import { createContext, useContext, useMemo } from 'react'
import { Calculator, MapPin, UserRound } from 'lucide-react'
import { Chip, ChipLabel } from '@/components/ui/chip'
import { SourcePreviewChip } from '@/features/chat/components/SourcePreview'
import type { CitationRef } from '@/features/chat/lib/citations'
import { useTranslations } from '@/i18n'
import { projectIntakeCopy } from '@/i18n/namespaces/project-intake'
import type { ProfileEvidence } from '@/lib/project-intake/types'
import { cn } from '@/lib/utils'

export const EvidenceProjectContext = createContext<string | undefined>(undefined)

type DocumentEvidence = Extract<ProfileEvidence, { kind: 'document' }>

export function citationOfEvidence(evidence: DocumentEvidence): CitationRef {
  const locus = {
    key: `${evidence.fileName}#${evidence.page ?? 'quote'}`,
    ...(evidence.page === null ? {} : { page: evidence.page }),
    snippet: evidence.quote,
    isCited: true,
  }
  return {
    document: {
      id: `intake:${evidence.fileName}`,
      title: evidence.fileName,
      fileName: evidence.fileName,
      shelf: 'project',
      kind: 'project',
      tint: 'project',
      loci: [locus],
    },
    locus,
  }
}

export function EvidenceChips({
  evidence,
  className,
}: {
  evidence: readonly ProfileEvidence[]
  className?: string
}): JSX.Element | null {
  if (evidence.length === 0) return null
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-1.5', className)} data-testid="evidence-chips">
      {evidence.map((entry, index) => (
        <li key={`${entry.kind}-${index}`} className="min-w-0 max-w-full">
          <EvidenceChip evidence={entry} />
        </li>
      ))}
    </ul>
  )
}

function EvidenceChip({ evidence }: { evidence: ProfileEvidence }): JSX.Element {
  const t = useTranslations(projectIntakeCopy)
  if (evidence.kind === 'document') return <DocumentChip evidence={evidence} />
  if (evidence.kind === 'geocoder') {
    return (
      <Chip variant="muted" title={evidence.label}>
        <MapPin aria-hidden />
        <ChipLabel>{t('evidence.geocoder')}</ChipLabel>
      </Chip>
    )
  }
  if (evidence.kind === 'register') {
    return (
      <Chip variant="muted" title={evidence.label}>
        <MapPin aria-hidden />
        <ChipLabel>{t('evidence.register')}</ChipLabel>
      </Chip>
    )
  }
  if (evidence.kind === 'derivation') {
    return (
      <Chip variant="muted" title={evidence.citation}>
        <Calculator aria-hidden />
        <ChipLabel>{t('evidence.derivation')}</ChipLabel>
      </Chip>
    )
  }
  return (
    <Chip variant="muted">
      <UserRound aria-hidden />
      <ChipLabel>{t('evidence.person')}</ChipLabel>
    </Chip>
  )
}

function DocumentChip({ evidence }: { evidence: DocumentEvidence }): JSX.Element {
  const t = useTranslations(projectIntakeCopy)
  const projectId = useContext(EvidenceProjectContext)
  const citation = useMemo(() => citationOfEvidence(evidence), [evidence])
  const label =
    evidence.page === null
      ? t('evidence.documentNoPage', { name: evidence.fileName })
      : t('evidence.document', { name: evidence.fileName, page: evidence.page })
  return <SourcePreviewChip citation={citation} label={label} projectId={projectId} className="sm:max-w-72" />
}
