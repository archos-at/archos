'use client'

import { type FC } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, FileSearch, FolderOpen, History, Link2 } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { SectionLabel } from '@/components/ui/section-label'
import { Spinner } from '@/components/ui/spinner'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import type { RevisionRef } from '@/lib/documents/revision-links'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import { documentPages, refPage, type CitationRef, type CitedDocument } from '../lib/citations'
import { isPrecedent } from '../lib/precedent'
import type { Shelf } from '@/lib/source-kinds'
import { useOpenCurrentRevision } from '../hooks/use-open-current-revision'
import { useChatStore } from '../store'
import { CopySourceCitationButton } from './CopyCitation'
import { CopyCitationLinkButton } from './CopyCitationLink'
import { CitationPageThumbnail } from './CitationPageThumbnail'

interface CitationPeekProps {
  citation: CitationRef
  snippet?: string
  onOpen?: () => void
  url?: string
  unavailable?: boolean
  onDownload?: () => void
  downloadPending?: boolean
  supersededBy?: RevisionRef | null
  presentation?: 'popover' | 'sheet'
  thumbnailDocumentId?: string
}

const BINDING_TONE: Record<string, string> = {
  binding: 'border-transparent bg-[var(--source-law,var(--foreground))] text-[var(--background)]',
  declared_binding: 'border-[var(--source-law,var(--foreground))] text-foreground',
  interpretive: 'border-border text-muted-foreground',
}

const BindingStatusChip: FC<{ status?: string }> = ({ status }) => {
  const t = useTranslations(chatCopy)
  if (!status || !(status in BINDING_TONE)) return null
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none pointer-coarse:text-xs',
        BINDING_TONE[status]
      )}
    >
      {t(`sourcePreview.binding.${status}`)}
    </span>
  )
}

export const PEEK_ACTION_CLASSES = cn(
  'inline-flex items-center gap-1 rounded-control text-xs font-medium outline-none hover:underline pointer-coarse:min-h-11',
  PRESSABLE,
  FOCUS_RING
)

export const LocusLine: FC<{ citation: CitationRef }> = ({ citation }) => {
  const t = useTranslations(chatCopy)
  const page = refPage(citation)
  const pages = documentPages(citation.document)

  const clause = citation.locus?.clause?.trim()
  const text = citation.locus
    ? page != null
      ? clause
        ? t('answerSources.clausePage', { clause, page })
        : t('answerSources.page', { page })
      : clause
        ? t('answerSources.clause', { clause })
        : t('citationPeek.wholeDocument')
    : pages.length === 1
      ? t('answerSources.page', { page: pages[0]! })
      : pages.length > 1
        ? t('answerSources.pages', { pages: pages.join(', ') })
        : t('citationPeek.wholeDocument')

  return <p className="text-xs tabular-nums text-muted-foreground">{text}</p>
}

const DocumentHomeLink: FC<{ shelf?: Shelf; tint: CitedDocument['tint'] }> = ({
  shelf,
  tint,
}) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((s) => s.projectId)

  const target =
    shelf === 'project' && projectId
      ? {
          href: `/app/projects/${encodeURIComponent(projectId)}/files`,
          label: t('documentAnswer.openInFiles'),
        }
      : shelf === 'office_shelf'
        ? { href: '/app/office-shelf', label: t('documentAnswer.openInOfficeShelf') }
        : null
  if (!target) return null

  return (
    <Link
      href={target.href}
      data-citation-home=""
      className={PEEK_ACTION_CLASSES}
      style={{ color: `var(--source-${tint}-text, var(--foreground))` }}
    >
      <FolderOpen aria-hidden="true" className="size-3.5" />
      {target.label}
    </Link>
  )
}

export const CitationOpenButton: FC<{
  tint: CitedDocument['tint']
  onOpen: () => void
  className?: string
  primary?: boolean
}> = ({ tint, onOpen, className, primary = false }) => {
  const t = useTranslations(chatCopy)
  if (primary) {
    return (
      <Button
        type="button"
        onClick={onOpen}
        data-citation-open=""
        className={cn('w-full gap-2', className)}
      >
        <FileSearch aria-hidden="true" className="size-4" />
        {t('citationPeek.openAtPage')}
      </Button>
    )
  }
  return (
    <button data-attr="chat-open"
      type="button"
      onClick={onOpen}
      data-citation-open=""
      className={cn(PEEK_ACTION_CLASSES, className)}
      style={{ color: `var(--source-${tint}-text, var(--foreground))` }}
    >
      <FileSearch aria-hidden="true" className="size-3.5" />
      {t('citationPeek.openAtPage')}
    </button>
  )
}

export const PeekDownloadButton: FC<{
  tint: CitedDocument['tint']
  onDownload: () => void
  pending?: boolean
}> = ({ tint, onDownload, pending = false }) => {
  const t = useTranslations(chatCopy)
  const showBusy = useDelayedFlag(pending)
  return (
    <button
      type="button"
      onClick={() => {
        if (!pending) onDownload()
      }}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      data-citation-download=""
      className={cn(PEEK_ACTION_CLASSES, pending && 'cursor-progress')}
      style={{ color: `var(--source-${tint}-text, var(--foreground))` }}
    >
      {showBusy ? (
        <Spinner size="xs" aria-hidden="true" />
      ) : (
        <Download aria-hidden="true" className="size-3.5" />
      )}
      {t(showBusy ? 'citationPeek.downloading' : 'citationPeek.download')}
    </button>
  )
}

const OlderRevisionLine: FC<{ current: RevisionRef }> = ({ current }) => {
  const t = useTranslations(chatCopy)
  const openCurrent = useOpenCurrentRevision()
  return (
    <p
      data-citation-older-revision=""
      className="flex flex-wrap items-baseline gap-x-1 text-xs leading-relaxed text-muted-foreground"
    >
      <History aria-hidden="true" className="size-3.5 shrink-0 self-center" />
      <span>{t('citationPeek.olderRevision')}</span>
      <button data-attr="chat-open-current"
        type="button"
        onClick={() => void openCurrent(current)}
        aria-label={t('citationPeek.openCurrentRevisionAria', { name: current.filename })}
        className={cn(PEEK_ACTION_CLASSES, 'break-all text-foreground underline')}
      >
        {current.filename}
      </button>
    </p>
  )
}

export const CitationPeek: FC<CitationPeekProps> = ({
  citation,
  snippet,
  onOpen,
  url,
  unavailable,
  onDownload,
  downloadPending,
  supersededBy,
  presentation = 'popover',
  thumbnailDocumentId,
}) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((s) => s.projectId)
  const { document: doc } = citation
  const tint = doc.tint
  const sheet = presentation === 'sheet'
  const regions = citation.locus?.regions
  const thumbnailPage = refPage(citation)

  return (
    <div className={sheet ? 'space-y-3' : 'space-y-2'} data-presentation={presentation}>
      {/* What kind of source this is — the answer to "can I rely on it?" */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceSignalChip signal={tint}>
          {t(isPrecedent(doc, projectId) ? 'sourcePreview.kinds.praezedenz' : `sourcePreview.kinds.${doc.kind}`)}
        </SourceSignalChip>
        {doc.laneLabel && (
          <span className="text-xs font-medium text-muted-foreground">{doc.laneLabel}</span>
        )}
        <BindingStatusChip status={doc.bindingStatus} />
      </div>

      <div>
        <p className="break-words text-sm font-medium text-foreground">{doc.title}</p>
        <LocusLine citation={citation} />
      </div>

      {/* The place itself: the sheet with the box on it, before the words that describe it. */}
      {thumbnailDocumentId && thumbnailPage != null && regions && regions.length > 0 && (
        <CitationPageThumbnail
          documentId={thumbnailDocumentId}
          page={thumbnailPage}
          regions={regions}
          color={`var(--source-${tint})`}
        />
      )}

      {supersededBy && <OlderRevisionLine current={supersededBy} />}

      {/* Does this actually bind me? The highest-value fact for a legal source. */}
      {doc.bindingNote && (
        <div
          className="rounded-control px-2.5 py-1.5"
          style={{
            backgroundColor: `var(--source-${tint}-tint, var(--muted))`,
          }}
        >
          <SectionLabel
            as="p"
            style={{ color: `var(--source-${tint}-text, var(--muted-foreground))` }}
          >
            {t('sourcePreview.bindingLabel')}
          </SectionLabel>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground">{doc.bindingNote}</p>
        </div>
      )}

      {/* The words themselves — the whole point of checking a citation. */}
      {snippet && (
        <div
          className="rounded-surface border px-3 py-2"
          style={{
            backgroundColor: `var(--source-${tint}-tint, var(--muted))`,
            borderColor: `color-mix(in oklch, var(--source-${tint}, var(--foreground)) 25%, transparent)`,
          }}
        >
          <SectionLabel
            as="p"
            style={{ color: `var(--source-${tint}-text, var(--muted-foreground))` }}
          >
            {t('sourcePreview.citedPassage')}
          </SectionLabel>
          <p
            className={cn(
              'mt-1 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground',
              sheet ? 'max-h-[38dvh] text-base' : 'max-h-32 text-sm'
            )}
          >
            {snippet}
          </p>
        </div>
      )}

      {/* WHY there is no viewer, before the control that works around it. Said
          in the popover rather than left to the reader's inference: "this
          format opens outside the app" is a fact about the file, and without it
          a download button beside a document chip reads as an arbitrary second
          choice. */}
      {onDownload && !onOpen && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('citationPeek.noInlineViewer')}
        </p>
      )}

      {/* The one thing a thumb wants next, before the secondary actions. */}
      {sheet && onOpen && <CitationOpenButton tint={tint} onOpen={onOpen} primary />}

      {/* A source with nothing to open is said in a sentence, never as a row that
          looks like a disabled control: it used to read as a row that could not
          open beside the copy buttons, a dead action on the one source the
          reader tapped to check. */}
      {unavailable && !onOpen && !onDownload && (
        <p className="text-xs leading-relaxed text-muted-foreground" data-citation-unavailable="">
          {t('citationPeek.notOpenable')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
        {onOpen && !sheet && <CitationOpenButton tint={tint} onOpen={onOpen} />}
        {onDownload && !onOpen && (
          <PeekDownloadButton tint={tint} onDownload={onDownload} pending={downloadPending} />
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={PEEK_ACTION_CLASSES}
            style={{ color: `var(--source-${tint}-text, var(--foreground))` }}
          >
            {t('sourcePreview.openExternal')}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
        <DocumentHomeLink shelf={doc.shelf} tint={tint} />
        <span className="flex-1" />
        <CopyCitationLinkButton citation={citation} icon={<Link2 className="size-3" />} />
        <CopySourceCitationButton citation={citation} />
      </div>
    </div>
  )
}
