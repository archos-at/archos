'use client'

import type { FC } from 'react'
import { Download, Link2, PanelRight, TextSearch } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { Spinner } from '@/components/ui/spinner'
import { PdfViewerDialog } from '@/features/knowledge/components/pdf-viewer-dialog'
import { SimilarPassagesPanel } from '@/features/similar-passages/components/similar-passages-panel'
import { openedPassageView } from '@/features/similar-passages/components/similar-passages-dialog'
import {
  useSimilarPassagesViewer,
  type DocumentSrcOf,
  type SimilarPassagesLoader,
} from '@/features/similar-passages/lib/use-similar-passages'
import { SIMILAR_PASSAGE_TEXT_MIN, type SimilarSourceDocument } from '@/lib/similar-passages/types'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import type { SourceTint } from '@/lib/source-kinds'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { citationViewerAction, runViewerActionNow, useViewerBesideChat } from '../../lib/viewer-actions'
import { toQuoteList } from '../../lib/source-citation'
import type { CitationLocus, CitationRef } from '../../lib/citations'
import { useChatStore } from '../../store'
import { COPY_ACTION_CLASSES, CopySourceCitationButton } from '../CopyCitation'
import { CopyCitationLinkButton } from '../CopyCitationLink'
import {
  asDownloadTarget,
  isImageTarget,
  isRenditionTarget,
  navigableLoci,
  type DocumentTarget,
} from './document-target'
import { useCitationDownload } from './use-citation-download'
import { useCitationStyles } from '../../hooks/use-citation-styles'
import { LocusRail } from './locus-rail'
import { CitedPassageBox } from './cited-passage-box'

export const CitationDocumentDialog: FC<{
  target: DocumentTarget
  citation?: CitationRef
  activeLocus?: CitationLocus
  onSelectLocus: (locus: CitationLocus) => void
  src?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  similarFixtures?: { load: SimilarPassagesLoader; srcOf: DocumentSrcOf }
}> = ({ target, citation, activeLocus, onSelectLocus, src, open, onOpenChange, similarFixtures }) => {
  const t = useTranslations(chatCopy)
  const tKnowledge = useTranslations(knowledgeCopy)
  const styles = useCitationStyles()
  const projectId = useChatStore((s) => s.projectId)
  const headerSignal: SourceTint =
    citation?.document.tint ?? (target.document.type === 'base' ? 'law' : 'project')
  const page = activeLocus?.page ?? target.page
  const regions = activeLocus?.regions
  const passage = regions?.length ? undefined : (activeLocus?.snippet ?? target.snippet)
  const railLoci = citation ? navigableLoci(citation.document) : []
  const passageInRail =
    Boolean(activeLocus?.snippet) && railLoci.some((locus) => locus.key === activeLocus?.key)
  const shown: CitationRef | undefined = citation && {
    document: citation.document,
    locus: activeLocus,
  }
  const rendition = isRenditionTarget(target)
  const { isDownloading, download } = useCitationDownload(
    rendition ? asDownloadTarget(target) : null
  )
  const downloadBusy = useDelayedFlag(isDownloading)

  const similar = useSimilarPassagesViewer()
  const sourceDocument: SimilarSourceDocument =
    target.document.type === 'stored'
      ? { kind: 'stored', documentId: target.document.id }
      : { kind: 'base', fileName: target.document.fileName }
  const findSimilar = (text: string, passagePage: number | null, cited: boolean): void =>
    similar.start({ document: sourceDocument, passage: { text, page: passagePage, cited }, projectId })
  const citedSearchable = !!passage && passage.trim().length >= SIMILAR_PASSAGE_TEXT_MIN
  const closeDialog = (next: boolean): void => {
    if (!next) similar.close()
    onOpenChange(next)
  }
  const besideChat = useViewerBesideChat()
  const beside =
    besideChat && target.document.type === 'stored' && target.document.shelf !== 'session' ? target.document : null
  const openBeside = async (): Promise<void> => {
    if (!beside) return
    const result = await runViewerActionNow(
      citationViewerAction({
        documentId: beside.id,
        documentName: beside.filename,
        page: page ?? null,
        passage,
        box: regions?.[0]?.box ?? null,
      })
    )
    if (result.outcome === 'shown') closeDialog(false)
    else toast.error(t(result.outcome === 'refused' ? `viewerActions.refused.${result.reason}` : 'viewerActions.status.failed'))
  }
  const similarRail = similar.request && (
    <SimilarPassagesPanel
      request={similar.request}
      opened={similar.opened}
      onOpen={similar.open}
      onBackToSource={similar.backToSource}
      onClose={similar.close}
      load={similarFixtures?.load}
    />
  )

  const openedView = similar.opened ? openedPassageView(similar.opened, similarFixtures?.srcOf) : null

  return (
    <PdfViewerDialog
      open={open}
      onOpenChange={closeDialog}
      fileName={
        target.document.type === 'base' ? target.document.fileName : target.document.filename
      }
      page={page ?? null}
      title={target.title}
      src={src}
      isImage={isImageTarget(target)}
      highlight={passage}
      regions={openedView ? undefined : regions}
      highlightColor={`var(--source-${headerSignal})`}
      quoteFormat={
        citation && !openedView
          ? ({ text, page: quotedPage }) =>
              toQuoteList(
                [
                  {
                    document: citation.document,
                    locus: { key: 'selection', page: quotedPage, snippet: text, isCited: true },
                  },
                ],
                new Date(),
                styles
              )
          : undefined
      }
      onFindSimilar={
        openedView ? undefined : ({ text, page: selectedPage }) => findSimilar(text, selectedPage, false)
      }
      headerChip={
        <SourceSignalChip signal={headerSignal}>
          {t(
            target.document.type === 'base'
              ? 'sourcePreview.corpusDocument'
              : 'sourcePreview.projectDocument'
          )}
        </SourceSignalChip>
      }
      headerActions={
        !openedView &&
        (shown || rendition || citedSearchable || beside) && (
          <span className="flex shrink-0 items-center gap-2">
            {beside && (
              <button data-attr="chat-open-beside"
                type="button"
                onClick={() => void openBeside()}
                data-open-beside-chat=""
                className={COPY_ACTION_CLASSES}
              >
                <PanelRight aria-hidden="true" className="size-3" />
                {t('sourcePreview.openBesideChat')}
              </button>
            )}
            {citedSearchable && (
              <button
                type="button"
                onClick={() => {
                  if (passage) findSimilar(passage, page ?? null, true)
                }}
                aria-label={tKnowledge('similar.forPassage')}
                data-find-similar=""
                className={COPY_ACTION_CLASSES}
              >
                <TextSearch aria-hidden="true" className="size-3" />
                {tKnowledge('similar.action')}
              </button>
            )}
            {rendition && (
              <>
                <span className="text-muted-foreground text-xs font-normal" data-rendition-note="">
                  {t('sourcePreview.renditionNote')}
                </span>
                {/* Busy, not disabled, for the reason the chip gives: the
                    reader's focus stays on the control they pressed. */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isDownloading) void download()
                  }}
                  aria-disabled={isDownloading || undefined}
                  aria-busy={isDownloading || undefined}
                  data-citation-download-original=""
                  className={cn(COPY_ACTION_CLASSES, isDownloading && 'cursor-progress')}
                >
                  {downloadBusy ? (
                    <Spinner size="xs" aria-hidden="true" className="[&_svg]:size-3" />
                  ) : (
                    <Download aria-hidden="true" className="size-3" />
                  )}
                  {t(downloadBusy ? 'citationPeek.downloading' : 'sourcePreview.downloadOriginal')}
                </button>
              </>
            )}
            {shown && (
              <>
                <CopyCitationLinkButton citation={shown} icon={<Link2 className="size-3" />} />
                <CopySourceCitationButton citation={shown} />
              </>
            )}
          </span>
        )
      }
      aside={
        similarRail ||
        (citation && (
          <LocusRail
            document={citation.document}
            activeKey={activeLocus?.key}
            onSelect={onSelectLocus}
          />
        ))
      }
      {...openedView}
    >
      {!openedView && passage && !passageInRail && <CitedPassageBox snippet={passage} signal={headerSignal} />}
    </PdfViewerDialog>
  )
}
