'use client'

import { useRef, useState, type CSSProperties, type FC } from 'react'
import { useHeightGlide } from '@/components/motion/height-glide'
import { Globe, Lock } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { cn } from '@/lib/utils'
import {
  answerDocuments,
  citationNumbers,
  documentPages,
  refHost,
  type CitationRef,
  type CitedDocument,
} from '../lib/citations'
import { useChatStore } from '../store'
import { isPrecedent } from '../lib/precedent'
import { SourcePreviewChip } from './SourcePreview'
import { CopyCitationsMenu } from './CopyCitation'
import { useCitationScope } from './CitationScope'
import { useCurrentProject } from '@/features/projects/lib/current-project'

interface AnswerSourcesRowProps {
  documents: CitedDocument[]
  anchorPrefix?: string
  routingDecision?: 'meta' | 'shallow' | 'deep' | 'error'
  isStreaming?: boolean
  withDivider?: boolean
}

const MAX_ANSWER_SOURCES = 8

const useClosedProjectNote = (): ((doc: CitedDocument) => string | null) => {
  const tProjects = useTranslations(projectsCopy)
  const current = useCurrentProject()
  return (doc) => {
    if (doc.kind !== 'project') return null
    if (doc.project) return doc.project.status === 'closed' ? tProjects('lifecycle.fileChipNoName') : null
    return current?.status === 'closed' ? tProjects('lifecycle.fileChip', { name: current.name }) : null
  }
}

const usePrecedentNote = (): ((doc: CitedDocument) => string | null) => {
  const t = useTranslations(chatCopy)
  const chatProjectId = useChatStore((s) => s.projectId)
  return (doc) => {
    if (!doc.project || !isPrecedent(doc, chatProjectId)) return null
    const { name, status, federalStateNote } = doc.project
    const named = t('answerSources.precedentProject', {
      name,
      status: t(`answerSources.projectStatus.${status}`),
    })
    return federalStateNote ? `${named} · ${federalStateNote}` : named
  }
}

const useSourceMeta = (): ((doc: CitedDocument) => string | undefined) => {
  const t = useTranslations(chatCopy)
  const closedNoteFor = useClosedProjectNote()
  const precedentNoteFor = usePrecedentNote()
  return (doc) => {
    const pages = documentPages(doc)
    const base =
      pages.length === 1
        ? t('answerSources.page', { page: pages[0]! })
        : pages.length > 1
          ? t('answerSources.pages', { pages: pages.join(', ') })
          : refHost({ document: doc })
    const note = precedentNoteFor(doc) ?? closedNoteFor(doc)
    if (!note) return base
    return base ? `${base} · ${note}` : note
  }
}

export const AnswerSourcesRow: FC<AnswerSourcesRowProps> = ({
  documents: allDocuments,
  anchorPrefix,
  routingDecision,
  isStreaming = false,
  withDivider = true,
}) => {
  const t = useTranslations(chatCopy)
  const metaFor = useSourceMeta()
  const closedNoteFor = useClosedProjectNote()
  const scope = useCitationScope()

  const [expanded, setExpanded] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  useHeightGlide(rowRef, expanded)
  const [arrivesLive] = useState(isStreaming)
  const entrance = arrivesLive
    ? 'animate-in fade-in-0 duration-base ease-entrance motion-reduce:animate-none'
    : undefined
  const documents = answerDocuments(allDocuments)
  const numbered = documents.filter((doc) => citationNumbers(doc).length > 0)
  const rest = documents.filter((doc) => citationNumbers(doc).length === 0)
  const folded = Math.max(0, MAX_ANSWER_SOURCES - numbered.length)
  const collapsed = [...numbered, ...rest.slice(0, folded)]
  const shown = expanded ? documents : collapsed
  const revealedIds = expanded ? new Set(documents.filter((doc) => !collapsed.includes(doc)).map((doc) => doc.id)) : null
  const hidden = documents.length - shown.length
  const display: CitedDocument[] = shown

  if (shown.length === 0) {
    const isSubstantive = routingDecision !== 'meta' && routingDecision !== 'error'
    if (!isSubstantive) return null
    if (isStreaming) {
      return <div className={cn('min-h-6', withDivider && 'border-t pt-2')} aria-hidden="true" />
    }

    return (
      <div
        className={cn(
          'flex min-h-6 flex-wrap items-center gap-1.5',
          withDivider && 'border-t pt-2',
          entrance
        )}
        role="note"
        aria-label={t('answerSources.gapAria')}
      >
        <span className="border-source-auto/40 bg-source-auto-tint text-source-auto-text inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-xs font-medium">
          <Globe className="size-3 shrink-0" aria-hidden="true" />
          {t('answerSources.gapLabel')}
        </span>
      </div>
    )
  }

  const refs: CitationRef[] = documents.map((doc) => ({ document: doc }))

  return (
    <div
      ref={rowRef}
      className={cn('flex min-h-6 flex-wrap items-center gap-1.5', withDivider && 'border-t pt-2')}
    >
      <SectionLabel>{t('answerSources.label')}</SectionLabel>
      {/* The list holds only the sources; the fold button and the copy menu
          beside it are not list items (axe aria-required-children). */}
      <div role="list" aria-label={t('answerSources.ariaLabel')} className="contents">
      {display.map((doc) => {
        const numbers = citationNumbers(doc)
        const isFocused = scope?.focused != null && numbers.includes(scope.focused)
        return (
          <span
            role="listitem"
            key={doc.id}
            className={cn(
              'inline-flex max-w-full',
              arrivesLive &&
                'animate-in fade-in-0 slide-in-from-bottom-1 duration-base ease-entrance [animation-fill-mode:backwards] motion-reduce:animate-none',
              revealedIds?.has(doc.id) &&
                'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none'
            )}
          >
            {/* The mark lives on an INNER element. On the list item it swapped
              the entrance class for the pulse and back, and removing the pulse
              re-added the entrance, so the chip played its entrance again
              2.2s after a citation click. */}
            <span
              data-focused={isFocused || undefined}
              className={cn(
                'inline-flex max-w-full scroll-mt-6 rounded-control',
                isFocused && 'animate-citation-pulse motion-reduce:animate-none'
              )}
              style={
                isFocused
                  ? ({ ['--citation-pulse' as string]: `var(--source-${doc.tint})` } as CSSProperties)
                  : undefined
              }
            >
            {/* One anchor per [N] this document carries, all resolving to this
              chip. A document cited as [2] and [7] is one chip that both
              markers scroll to — which is the truth, and what the 1:1 shape
              could only fake by rendering the document twice. */}
            {anchorPrefix &&
              numbers.map((number) => (
                <span key={number} id={`${anchorPrefix}${number}`} className="scroll-mt-6" />
              ))}
            <SourcePreviewChip citation={{ document: doc }} meta={metaFor(doc)} />
            {/* On the face too, not only in the popover: a closed project's file. */}
            {closedNoteFor(doc) && (
              <span className="text-muted-foreground ml-1 inline-flex items-center align-middle" title={closedNoteFor(doc) ?? undefined}>
                <Lock className="size-3" aria-hidden />
                <span className="sr-only">{closedNoteFor(doc)}</span>
              </span>
            )}
            </span>
          </span>
        )
      })}
      </div>
      {(hidden > 0 || expanded) && documents.length > MAX_ANSWER_SOURCES && (
        <button data-attr="answer-sources-more"
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-testid="answer-sources-more"
          className="rounded-control text-muted-foreground duration-quick hover:text-foreground focus-visible:ring-ring/60 cursor-pointer text-xs leading-relaxed underline decoration-dotted underline-offset-2 transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:px-2"
        >
          {expanded ? t('answerSources.less') : t('answerSources.more', { count: hidden })}
        </button>
      )}
      {/* Every source of this answer as a citation, in the format the user's
          own tooling reads. Quiet, at the end of the row. */}
      <CopyCitationsMenu citations={refs} />
    </div>
  )
}
