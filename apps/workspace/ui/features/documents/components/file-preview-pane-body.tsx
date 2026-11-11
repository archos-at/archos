

import { documentFileUrl } from '@/lib/documents/urls'

import { cn } from '@/lib/utils'

import { SimilarPassagesDialog } from '@/features/similar-passages/components/similar-passages-dialog'

import { FilePreviewDocumentPanel } from './file-preview-pane-document'
import { FilePreviewDetailsPanel } from './file-preview-pane-details'
import type { FilePreviewController } from './use-file-preview-controller'

export function FilePreviewBody({ controller }: { controller: FilePreviewController }) {
  const { actions, file, peeking, reader, setSimilarAsk, similarAsk } = controller
  return (
    <>
        <SimilarPassagesDialog
          request={similarAsk}
          source={{ src: documentFileUrl(file.id), fileName: actions.name, title: actions.name }}
          onClose={() => setSimilarAsk(null)}
        />

        {/* Body split — document preview on the left, indexed metadata on the
            right. Two independently-scrolling columns side-by-side in the wide
            Dateien modal (`@2xl`+); a SINGLE vertical scroll (preview capped, all
            metadata flowing below) in a narrow container / mobile sheet.

            The scroll chain matters: `min-h-0` lets this flex child actually
            shrink below its content, and the overflow lives on the RIGHT layer for
            each mode — the body itself scrolls when stacked, each column scrolls
            when split. Without a bounded panel above (the dialog now gives one)
            this used to overflow into the panel's `overflow-hidden` and clip the
            metadata unreachably. */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overscroll-contain',
            peeking || reader ? 'overflow-hidden' : '@2xl:flex-row @2xl:overflow-hidden overflow-y-auto',
            // The desk under both columns: the rail's foot fades by a mask (`scroll-fade-bottom`), which shows what lies
            // under it, and that was the dialog's white sheet, a white band at the rail's foot.
            !peeking && !reader && 'bg-desk'
          )}
        >
        <FilePreviewDocumentPanel controller={controller} />
        <FilePreviewDetailsPanel controller={controller} />
        </div>
    </>
  )
}
