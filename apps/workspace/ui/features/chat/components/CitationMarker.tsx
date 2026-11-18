'use client'

import { type FC, type ReactNode, useRef, useState } from 'react'
import { PRESSABLE } from '@/components/ui/press'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { commonCopy } from '@/i18n/namespaces/common'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { citationSnippet, type CitationRef } from '../lib/citations'
import { useHoverPopover, type HoverPopover } from '@/hooks/use-hover-popover'
import { useCitationScope } from './CitationScope'
import { thumbnailDocumentId } from './CitationPageThumbnail'
import { CitationPeek } from './CitationPeek'
import { SourceDocumentDialog } from './source-preview/source-document-dialog'
import { useCitationDownload } from './source-preview/use-citation-download'
import { useSourcePreviewIndex } from './source-preview/use-source-preview-index'
import { citedFileName, resolveCitationTarget } from '../lib/citations/target'
import { useChatStore } from '../store'
import { PENDING_CITATION_ANCHOR_PREFIX } from '@/features/layout/lib/citation-markers'
import { useAnswerLive } from './CardSlotArrival'
import { useCoarsePointer } from '../hooks/use-coarse-pointer'

export const CitationMarker: FC<{ href: string; fallback: ReactNode }> = ({ href, fallback }) => {
  const scope = useCitationScope()
  const t = useTranslations(chatCopy)
  const [openDocument, setOpenDocument] = useState<CitationRef | null>(null)
  const peek = useHoverPopover()
  const live = useAnswerLive()
  const touch = useCoarsePointer()
  const returningFocus = useRef(false)

  const pending = numberFromHref(href, PENDING_CITATION_ANCHOR_PREFIX)
  if (pending != null) return live ? <PendingCitationMarker number={pending} /> : <>{`[${pending}]`}</>
  const number = scope ? numberFromHref(href, scope.anchorPrefix) : null
  const ref = number != null ? scope?.referenceFor(number) : undefined
  if (!scope || number == null || !ref) return <>{fallback}</>

  const snippet = ref.locus?.snippet ?? citationSnippet({ content: ref.document.snippet ?? '' })

  return (
    <>
      <button
        type="button"
        data-citation-marker={number}
        {...peek.triggerProps}
        onFocus={() => {
          if (touch || returningFocus.current) peek.triggerProps.onPointerDown()
          else peek.triggerProps.onFocus()
        }}
        onClick={() => {
          peek.triggerProps.onClick()
          scope.focus(number)
        }}
        aria-label={t('citationPeek.markerAria', {
          number,
          label: ref.document.title,
        })}
        className={cn(
          'inline-flex items-center rounded-control px-[3px]',
          'relative -top-[0.15em] text-[0.68em] font-semibold leading-[1.45] tabular-nums',
          'pointer-coarse:min-h-[26px] pointer-coarse:justify-center pointer-coarse:px-[7px] pointer-coarse:text-[0.78em]',
          PRESSABLE,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          'hover:brightness-95 dark:hover:brightness-125'
        )}
        style={{
          backgroundColor: `var(--source-${ref.document.tint}-tint, var(--muted))`,
          color: `var(--source-${ref.document.tint}-text, var(--muted-foreground))`,
        }}
      >
        {number}
      </button>
      {/* Beside the marker, not around it, and mounted on first engagement:
          see `HoverPeekPanel`. A read answer holds dozens of these. On a touch
          device the same content is the body of a bottom sheet instead. */}
      {touch ? (
        peek.engaged && (
          <CitationSheet
            peek={peek}
            number={number}
            onReturnFocus={() => {
              returningFocus.current = true
              peek.anchorRef.current?.focus({ preventScroll: true })
              returningFocus.current = false
            }}
          >
            <ResolvedCitationPeek
              citation={ref}
              snippet={snippet}
              presentation="sheet"
              onOpen={() => {
                peek.dismiss()
                setOpenDocument(ref)
              }}
            />
          </CitationSheet>
        )
      ) : (
        <HoverPeekPanel peek={peek} className="w-80 p-3">
          <ResolvedCitationPeek
            citation={ref}
            snippet={snippet}
            onOpen={() => {
              peek.dismiss()
              setOpenDocument(ref)
            }}
          />
        </HoverPeekPanel>
      )}
      {/* Mounted only once opened, so a page of markers costs no fetches. */}
      {/* The reference carries the page, so the dialog needs nothing else. */}
      {openDocument && (
        <SourceDocumentDialog citation={openDocument} onClose={() => setOpenDocument(null)} />
      )}
    </>
  )
}

export const CitationMarkers: FC<{ numbers: readonly number[]; className?: string }> = ({
  numbers,
  className,
}) => {
  const scope = useCitationScope()
  if (numbers.length === 0) return null
  return (
    <span data-citation-markers="" className={cn('inline-flex flex-wrap items-baseline gap-1', className)}>
      {numbers.map((number) =>
        scope ? (
          <CitationMarker
            key={number}
            href={`#${scope.anchorPrefix}${number}`}
            fallback={<>{`[${number}]`}</>}
          />
        ) : (
          <span key={number}>{`[${number}]`}</span>
        )
      )}
    </span>
  )
}

const CitationSheet: FC<{
  peek: HoverPopover
  number: number
  onReturnFocus: () => void
  children: ReactNode
}> = ({ peek, number, onReturnFocus, children }) => {
  const t = useTranslations(chatCopy)
  const tCommon = useTranslations(commonCopy)
  return (
    <Sheet open={peek.open} onOpenChange={peek.onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={tCommon('actions.close')}
        onInteractOutside={peek.contentProps.onInteractOutside}
        data-citation-sheet=""
        className="max-h-[82dvh] gap-3 rounded-t-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}
      >
        <SheetHeader className="pr-11">
          <SheetTitle className="text-sm">{t('citationPeek.sheetTitle', { number })}</SheetTitle>
          <SheetDescription className="sr-only">{t('citationPeek.sheetDescription')}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}

const PendingCitationMarker: FC<{ number: number }> = ({ number }) => {
  const t = useTranslations(chatCopy)
  return (
    <span
      data-citation-pending={number}
      role="img"
      aria-label={t('citationPeek.pendingAria', { number })}
      className={cn(
        'inline-flex items-center rounded-control px-[3px]',
        'relative -top-[0.15em] text-[0.68em] font-semibold leading-[1.45] tabular-nums',
        'pointer-coarse:min-h-[26px] pointer-coarse:justify-center pointer-coarse:px-[7px] pointer-coarse:text-[0.78em]',
        'bg-muted text-muted-foreground'
      )}
    >
      {number}
    </span>
  )
}

const ResolvedCitationPeek: FC<{
  citation: CitationRef
  snippet?: string
  onOpen: () => void
  presentation?: 'popover' | 'sheet'
}> = ({ citation, snippet, onOpen, presentation }) => {
  const projectId = useChatStore((s) => s.projectId)
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const url = citation.document.url
  const previewIndex = useSourcePreviewIndex(projectId, conversationId, !url, citedFileName(citation.document))

  const target = resolveCitationTarget(citation.document, {
    locus: citation.locus,
    storedDocuments: previewIndex?.storedDocuments,
    baseCorpusFiles: previewIndex?.baseCorpusFiles,
  })

  const resolving = !url && previewIndex === null
  const downloadTarget = target.kind === 'download' ? target : null
  const { isDownloading, download } = useCitationDownload(downloadTarget)
  const openable = target.kind === 'document' || target.kind === 'ris'

  return (
    <CitationPeek
      citation={citation}
      snippet={snippet}
      url={url}
      presentation={presentation}
      thumbnailDocumentId={thumbnailDocumentId(target)}
      onOpen={openable ? onOpen : undefined}
      onDownload={downloadTarget ? () => void download() : undefined}
      downloadPending={isDownloading}
      unavailable={!url && !resolving && !downloadTarget && !openable}
      supersededBy={target.kind === 'document' || target.kind === 'download' ? target.supersededBy : undefined}
    />
  )
}

const numberFromHref = (href: string, anchorPrefix: string): number | null => {
  const id = href.startsWith('#') ? href.slice(1) : href
  if (!id.startsWith(anchorPrefix)) return null
  const number = Number(id.slice(anchorPrefix.length))
  return Number.isInteger(number) && number > 0 ? number : null
}
