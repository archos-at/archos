'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InsetStage } from '@/components/ui/inset-stage'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { PdfDocumentView } from './pdf-document-view'
import { RegionMarks } from './region-marks'
import { PageSheet } from './pdf-viewer-atoms'
import type { PageRegion } from '../lib/page-region'

export interface PdfViewerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  page?: number | null
  title?: string
  src?: string
  isImage?: boolean
  highlight?: string | null
  highlightColor?: string
  regions?: readonly PageRegion[] | null
  quoteFormat?: (quote: { text: string; page: number }) => string
  onFindSimilar?: (passage: { text: string; page: number }) => void
  imageUnoptimized?: boolean
  headerChip?: ReactNode
  headerActions?: ReactNode
  children?: ReactNode
  aside?: ReactNode
}

export function PdfViewerDialog({ open, onOpenChange, fileName, page, title, src: srcOverride, isImage, imageUnoptimized = true, highlight, highlightColor, regions, quoteFormat, onFindSimilar, headerChip, headerActions, children, aside }: PdfViewerDialogProps) {
  const t = useTranslations(knowledgeCopy)
  const baseSrc = srcOverride ?? `/api/knowledge-base/documents/${encodeURIComponent(fileName)}`
  const src = page && !isImage ? `${baseSrc}#page=${page}` : baseSrc

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Near-fullscreen so the document renders large at its own aspect ratio.
        The `sm:max-w-*` override is load-bearing: the base DialogContent carries
        `sm:max-w-lg` (32rem), and tailwind-merge keeps it because a plain
        `max-w-*` sits in a different variant — so at any ≥sm viewport the dialog
        was silently clamped to 512px, turning it tall-and-narrow and letterboxing
        wide/landscape drawings (a small page over a large dark void). Setting the
        `sm:` width here is what actually lets it fill the viewport.
      */}
      {/*
        On a phone, upright or on its side, the document is the screen: the
        same full-screen reader a file from Dateien opens in, edge to edge,
        with the header compact under the status bar and the stage running
        to the home indicator. A 90dvh card left a drawing a 345px column
        with the dimmed page around it.
      */}
      <DialogContent
        mobilePresentation="fullscreen"
        data-testid="pdf-viewer-dialog"
        className="flex h-[90dvh] w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] max-w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] sm:max-w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))] flex-col gap-3 p-4 sm:p-5 phone:h-dvh phone:max-h-dvh phone:w-screen phone:gap-0 phone:p-0"
      >
        <DialogHeader className="shrink-0 pr-8 text-left phone:gap-1 phone:pt-[max(0.75rem,env(safe-area-inset-top))] phone:pr-[calc(env(safe-area-inset-right)+3.75rem)] phone:pb-2 phone:pl-[max(1rem,env(safe-area-inset-left))]">
          {/* `flex-wrap`: the chip and the title hold the first line, the
              actions drop to a second one when the row cannot hold them all.
              Unwrapped, a phone header was chip + two copy buttons and nothing
              else — the document's own name never rendered, and the row ran
              under the close button. */}
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            {headerChip}
            {/* Cut in the middle, so an edition or a revision at the end of
                the name (`…_Ausgabe_2023.pdf`) survives the narrow header. */}
            <span className="flex min-w-0 flex-1">
              <MiddleTruncate text={title ?? fileName} />
            </span>
            {headerActions}
          </DialogTitle>
          {/* On a phone on its side every line above the document is a line
              of the document lost, and this one (the source note and the
              browser's own viewer) is the one the reader needs least there. */}
          <DialogDescription className="flex items-center gap-3 text-xs phone:landscape:hidden">
            {t('viewer.description')}
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary transition-opacity duration-quick ease-out hover:opacity-80"
            >
              <ExternalLink className="size-3" aria-hidden />
              {t('viewer.openInTab')}
            </a>
          </DialogDescription>
        </DialogHeader>
        {children && (
          <div className="contents phone:block phone:shrink-0 phone:px-[max(0.75rem,env(safe-area-inset-left))] phone:pb-2">
            {children}
          </div>
        )}
        {/* The frame and its aside share the dialog's remaining height. Without
            an aside this is a single flex child filling the row exactly as it
            did before, so every caller that passes none is unaffected. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row phone:gap-0 phone:pb-[env(safe-area-inset-bottom)]">
          {aside}
          {open &&
            (isImage ? (
              <InsetStage className="min-h-0 w-full flex-1 overflow-auto overscroll-contain p-3">
                {/* The source streams at whatever size it happens to be, so
                    there is no intrinsic ratio to declare: 0/0 plus explicit
                    `w-auto h-auto` hands sizing back to CSS and keeps the image
                    at its natural size in the scroll frame, exactly as before.
                    The `w-auto` is not decoration — drop it and the browser
                    sizes the image to the width="0" attribute. */}
                {/* `relative w-fit`: the wrapper shrinks to the image, so a
                    region's percentages are shares of the IMAGE, not of the
                    scroll frame around it. */}
                <PageSheet className="mx-auto w-fit max-w-full">
                  <Image
                    src={src}
                    alt={title ?? fileName}
                    width={0}
                    height={0}
                    sizes="95vw"
                    unoptimized={imageUnoptimized}
                    className="block h-auto w-auto max-w-full"
                  />
                  {regions?.length ? <RegionMarks regions={regions} color={highlightColor} /> : null}
                </PageSheet>
              </InsetStage>
            ) : (
              <PdfDocumentView
                src={baseSrc}
                bleed
                title={title ?? fileName}
                page={page}
                highlight={highlight}
                highlightColor={highlightColor}
                regions={regions}
                quoteFormat={quoteFormat}
                onFindSimilar={onFindSimilar}
              />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
