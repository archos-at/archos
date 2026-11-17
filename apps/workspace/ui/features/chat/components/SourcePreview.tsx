'use client'

import { useState, type FC, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SourceSignalChip, SourceSignalChipLink } from '@/features/layout/components/SourceSignalChip'
import { useChatStore } from '../store'
import { isPrecedent } from '../lib/precedent'
import {
  citationNumbers,
  citedFileName,
  resolveCitationTarget,
  type CitationRef,
  type CitationTarget,
} from '../lib/citations'
import { AuthorityTag } from './AuthorityTag'
import {
  CitationFace,
  CitationIndex,
  faceClasses,
  faceStyle,
  inertCardClasses,
  type CitationDetail,
  type CitationVariant,
} from './source-preview/citation-face'
import { citationLabel, documentProjectId } from './source-preview/citation-label'
import { asDownloadTarget } from './source-preview/document-target'
import { useConversationId, useSourcePreviewIndex } from './source-preview/use-source-preview-index'
import { DocumentPreviewChip } from './source-preview/document-preview-chip'
import { DownloadPreviewChip } from './source-preview/download-preview-chip'
import { InfoPreviewChip } from './source-preview/info-preview-chip'
import { RisPreviewChip } from './source-preview/ris-preview-chip'

export interface SourcePreviewChipProps {
  citation: CitationRef
  meta?: string
  className?: string
  variant?: CitationVariant
  trailing?: ReactNode
  detail?: CitationDetail
  projectId?: string | null
  label?: string
}


export const SourcePreviewChip: FC<SourcePreviewChipProps> = ({
  citation,
  className,
  meta,
  variant = 'chip',
  trailing,
  detail = 'full',
  projectId: projectIdOverride,
  label: labelOverride,
}) => {
  const chatProjectId = useChatStore((s) => s.projectId)
  const projectId = projectIdOverride === undefined ? chatProjectId : projectIdOverride
  const conversationId = useConversationId()
  const { document: doc, locus } = citation
  const needsIndex = !doc.url && !!doc.fileName
  const previewIndex = useSourcePreviewIndex(
    documentProjectId(doc, projectId),
    conversationId,
    needsIndex,
    citedFileName(doc)
  )
  const [unrenderableId, setUnrenderableId] = useState<string | null>(null)

  const resolved = resolveCitationTarget(doc, {
    locus,
    storedDocuments: previewIndex?.storedDocuments,
    baseCorpusFiles: previewIndex?.baseCorpusFiles,
  })
  const target: CitationTarget =
    resolved.kind === 'document' &&
    resolved.document.type === 'stored' &&
    resolved.document.id === unrenderableId
      ? (asDownloadTarget(resolved) ?? resolved)
      : resolved

  const label = labelOverride ?? citationLabel(doc)
  const precedent = isPrecedent(doc, projectId)
  const numbers = locus
    ? [locus.number].filter((n): n is number => n != null)
    : citationNumbers(doc)
  const index = numbers.length > 0 ? numbers.join(', ') : undefined
  const shared = {
    signal: doc.tint,
    label,
    authority: doc.authority,
    className,
    index,
    variant,
    citation,
    trailing,
    detail,
    kind: doc.kind,
    precedent,
  }

  if (target.kind === 'url') {
    if (doc.bindingNote || doc.laneLabel) {
      return (
        <InfoPreviewChip
          {...shared}
          target={{ kind: 'info', title: label }}
          tier={doc.laneLabel}
          bindingNote={doc.bindingNote}
          url={target.url}
          meta={meta}
        />
      )
    }
    if (variant === 'card') {
      return (
        <a
          href={target.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(faceClasses(variant), className)}
          style={faceStyle(variant, doc.tint)}
          title={target.url}
        >
          <CitationFace {...shared} />
        </a>
      )
    }
    return (
      <SourceSignalChipLink
        signal={doc.tint}
        href={target.url}
        className={cn('max-w-56 rounded-control', className)}
      >
        <CitationIndex index={index} />
        {doc.authority && <AuthorityTag>{doc.authority}</AuthorityTag>}
        {label}
      </SourceSignalChipLink>
    )
  }

  if (target.kind === 'ris') {
    return <RisPreviewChip {...shared} target={target} />
  }

  if (target.kind === 'document') {
    const storedId = target.document.type === 'stored' ? target.document.id : null
    return (
      <DocumentPreviewChip
        {...shared}
        target={target}
        onUnrenderable={storedId ? () => setUnrenderableId(storedId) : undefined}
      />
    )
  }

  if (target.kind === 'download') {
    return (
      <DownloadPreviewChip
        {...shared}
        target={target}
        tier={doc.laneLabel}
        bindingNote={doc.bindingNote}
        meta={meta}
      />
    )
  }

  const resolving = needsIndex && !previewIndex

  const canCite = !!doc.fileName || !!doc.url || doc.loci.length > 0
  const hasPopoverContent =
    !resolving &&
    (canCite || !!target.snippet || !!doc.laneLabel || !!doc.bindingNote || !!meta || !!index)
  if (hasPopoverContent) {
    return (
      <InfoPreviewChip
        {...shared}
        target={target}
        tier={doc.laneLabel}
        bindingNote={doc.bindingNote}
        meta={meta}
      />
    )
  }

  if (variant === 'card') {
    return (
      <div className={cn(inertCardClasses, className)} style={faceStyle(variant, doc.tint)}>
        <CitationFace {...shared} />
      </div>
    )
  }

  return (
    <SourceSignalChip signal={doc.tint} className={cn('max-w-56', className)}>
      <CitationIndex index={index} />
      {doc.authority && <AuthorityTag>{doc.authority}</AuthorityTag>}
      {label}
    </SourceSignalChip>
  )
}
