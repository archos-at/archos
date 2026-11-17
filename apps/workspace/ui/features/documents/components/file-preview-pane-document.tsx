

import { FileTextPage } from './file-text-page'
import Image from 'next/image'

import { Download, RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { documentFileUrl } from '@/lib/documents/urls'

import { isOptimizerEligible } from '@/lib/images/optimizable'
import { cn } from '@/lib/utils'

import { PdfDocumentView } from '@/features/knowledge/components/pdf-document-view'

import { dropFileSubject } from '../lib/open-file-peek'

import { ReviewPageLayer } from './review/review-page-layer'
import { InlineMarkPeek } from './inline-mark-peek'

import { PageMock, PeekPanel, PeekStage } from './file-preview-peek'

import { IfcFilePreview } from './file-preview-pane-lazy'
import type { FilePreviewController } from './use-file-preview-controller'

export function FilePreviewDocumentPanel({ controller }: { controller: FilePreviewController }) {
  const { actions, annotateLead, canPreview, file, findSimilar, handlePdfFailed, inlineViewer, isHeld, isLoading, isModel, isOfficeRendition, isTextual, kind, linkedLocus, loadPreview, openReview, pdfInWell, peekView, peeking, previewFailed, previewGone, previewImageUrl, previewText, previewUrl, projectId, reader, review, setPreviewFailed, setPreviewImageUrl, setPreviewUrl, showModels, shownFinding, shownPage, shownType, sideways, t, viewerTarget, wellHostsViewer, wellRef } = controller
  return (
    <>
          {/* Left: live preview, or a decorative page mock while loading / when
              there is no inline preview. Stacked (mobile): a capped ~50dvh block
              that clips to itself so a tall document/image never pushes the
              metadata off-screen. Split (@2xl+): an independently-scrollable
              column. The Maximize2 affordance in the header still opens the
              full-screen viewer for PDFs and images. */}
          {/* The ground under the document. A flat grey box read as "an iframe in
              a panel"; a flat tone with the page set on it on a
              hairline reads as a document ON something — which is what a
              drawing on a desk actually looks like, and the whole reason this
              column exists rather than a download link. */}
          <PeekPanel peeking={peeking} active={peekView === 'document'} view="document">
          <PeekStage peeking={peeking}>
            <div
              ref={wellRef}
              data-testid="file-preview-well"
              tabIndex={0}
              className={cn(
                'focus-visible:ring-ring/60 flex min-w-0 justify-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                !peeking && !pdfInWell && 'bg-desk',
                wellHostsViewer || (reader && (isModel || pdfInWell))
                  ? cn(
                      'h-full min-h-0 flex-1 overflow-hidden',
                      reader && sideways && 'pb-[env(safe-area-inset-bottom)]',
                    )
                  : reader
                  ? // The reader's well for what is not a viewer of its own (an
                    'min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:my-auto'
                  : peeking
                  ? // THE GROUND IS THE DOCUMENT'S, and the document sits centred on
                    'scroll-fade-bottom h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 [&>*]:my-auto'
                    : pdfInWell
                      ? '@2xl:h-auto @2xl:min-h-0 @2xl:flex-1 @2xl:p-4 h-[50dvh] min-h-[50dvh] shrink-0 overflow-hidden p-3'
                      : '@2xl:h-auto @2xl:min-h-0 @2xl:flex-1 @2xl:overflow-y-auto @2xl:overscroll-contain @2xl:p-7 h-[50dvh] min-h-[50dvh] shrink-0 overflow-hidden p-5'
              )}
            >
              {isModel ? (
                <IfcFilePreview
                  documentId={file.id}
                  filename={file.filename}
                  projectId={projectId}
                  canOpenWorkspace={showModels}
                  className="size-full"
                />
              ) : isTextual && isLoading ? (
                <PageMock skeleton />
              ) : isTextual && previewText ? (
                <FileTextPage
                  text={previewText.text}
                  truncated={previewText.truncated}
                  contentType={file.contentType}
                  truncatedLabel={t('preview.textTruncated')}
                  peeking={peeking}
                />
              ) : canPreview && isLoading ? (
                <PageMock
                  skeleton
                  caption={isOfficeRendition ? t('preview.renditionPending') : undefined}
                />
              ) : canPreview && previewUrl ? (
                shownType === 'application/pdf' ? (
                  inlineViewer ? (
                    <PdfDocumentView
                      key={file.id}
                      src={documentFileUrl(file.id)}
                      title={actions.name}
                      page={shownPage === 'turning' ? null : (shownPage ?? linkedLocus.page ?? shownFinding?.page ?? null)}
                      highlight={
                        viewerTarget?.passage ??
                        (shownPage === null ? (linkedLocus.highlight ?? shownFinding?.highlight ?? null) : null)
                      }
                      regions={viewerTarget?.regions ?? null}
                      onFindSimilar={findSimilar}
                      onLoadError={handlePdfFailed}
                      ground={peeking ? 'host' : 'stage'}
                      bleed={reader}
                      pageOverlay={(page) => (
                        <>
                          <ReviewPageLayer page={page} review={review} focused={false} onOpenMark={openReview} />
                          <InlineMarkPeek page={page} review={review} onOpenMark={openReview} />
                        </>
                      )}
                      toolbarLead={annotateLead}
                      className="size-full"
                    />
                  ) : (
                    <PageMock skeleton />
                  )
                ) : (
                  <Image
                    src={previewImageUrl ?? previewUrl}
                    alt={actions.name}
                    width={0}
                    height={0}
                    sizes="(min-width: 1536px) 720px, 90vw"
                    unoptimized={!isOptimizerEligible(previewImageUrl ?? previewUrl)}
                    onError={() => {
                      setPreviewUrl(null)
                      setPreviewImageUrl(null)
                      setPreviewFailed(true)
                    }}
                    className={cn(
                      'bg-sheet h-fit max-h-full w-auto max-w-full rounded-surface object-contain',
                      !reader && '@2xl:max-h-none',
                      'shadow-md' /* the page lies on the stage at elevation 2: elevation 3 is a dialog's, and drew a wide halo no token named */
                    )}
                  />
                )
              ) : (
                <PageMock
                  kind={kind}
                  caption={
                    previewGone
                      ? t('preview.gone')
                      : previewFailed
                        ? isHeld
                          ? t('preview.heldNoPreview')
                          : t('preview.loadFailed')
                        : t('preview.noInlinePreview')
                  }
                  action={
                    previewGone ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() =>
                          dropFileSubject({
                            cleared: t('preview.goneCleared'),
                            undo: t('preview.goneUndo'),
                          })
                        }
                      >
                        <X className="size-3.5" aria-hidden />
                        {t('preview.goneAction')}
                      </Button>
                    ) : previewFailed && isHeld ? // No retry: a held file's bytes stay withheld until it is released, so it meets the same refusal.
                    null : previewFailed && (canPreview || isTextual) ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={loadPreview}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {t('preview.tryAgain')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void actions.download()}
                        disabled={actions.isDownloading}
                      >
                        <Download className="size-3.5" aria-hidden />
                        {t('preview.download')}
                      </Button>
                    )
                  }
                />
              )}
            </div>
          </PeekStage>

          {/* No summary under the document any more. The read summary stood here
              as a footer band, which made the peek beside a conversation two things
              at once; it is a section of the details now, behind the ⓘ in the
              peek's toolbar, and the document has the column. */}
          </PeekPanel>
    </>
  )
}
