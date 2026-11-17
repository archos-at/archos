'use client'

import { useState, type FC } from 'react'
import { ExcerptMargin, OpenPassageButton } from '@/shared/components/MarkdownRenderer/answer-atoms'
import type { ExcerptSourceProps } from '@/shared/components/MarkdownRenderer/answer-block-context'
import type { CitationRef } from '../lib/citations'
import { citedFileName, resolveCitationTarget } from '../lib/citations/target'
import { useChatStore } from '../store'
import { CitationOpenButton, LocusLine } from './CitationPeek'
import { useCitationScope } from './CitationScope'
import { SourceDocumentDialog } from './source-preview/source-document-dialog'
import { useSourcePreviewIndex } from './source-preview/use-source-preview-index'

export const CitationExcerptSource: FC<ExcerptSourceProps> = ({ number, stamp }) => {
  const scope = useCitationScope()
  const ref = scope?.referenceFor(stamp?.number ?? number) ?? scope?.referenceFor(number)
  if (!ref) return null
  return <ResolvedExcerptSource citation={atQuote(ref, stamp)} verified={stamp?.status === 'verbatim'} />
}

function atQuote(citation: CitationRef, stamp: ExcerptSourceProps['stamp']): CitationRef {
  if (!stamp || stamp.status !== 'verbatim') return citation
  const base = citation.locus ?? { key: `quote:${stamp.page ?? ''}`, isCited: true }
  return {
    document: citation.document,
    locus: {
      ...base,
      key: `${base.key}#quote`,
      page: stamp.page ?? base.page,
      clause: stamp.clause ?? base.clause,
      snippet: stamp.text,
    },
  }
}

const ResolvedExcerptSource: FC<{ citation: CitationRef; verified: boolean }> = ({ citation, verified }) => {
  const [open, setOpen] = useState(false)
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const url = citation.document.url
  const previewIndex = useSourcePreviewIndex(projectId, conversationId, !url, citedFileName(citation.document))
  const target = resolveCitationTarget(citation.document, {
    locus: citation.locus,
    storedDocuments: previewIndex?.storedDocuments,
    baseCorpusFiles: previewIndex?.baseCorpusFiles,
  })
  const openable = target.kind === 'document' || target.kind === 'ris'
  return (
    <>
      <ExcerptMargin
        title={citation.document.title}
        locus={<LocusLine citation={citation} />}
        action={
          !openable ? undefined : verified ? (
            <OpenPassageButton onOpen={() => setOpen(true)} />
          ) : (
            <CitationOpenButton
              tint={citation.document.tint}
              onOpen={() => setOpen(true)}
              className="touch-target pointer-coarse:min-h-0"
            />
          )
        }
      />
      {open && <SourceDocumentDialog citation={citation} onClose={() => setOpen(false)} />}
    </>
  )
}
