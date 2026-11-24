'use client'

import { memo, useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import Image from 'next/image'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { isOptimizerEligible } from '@/lib/images/optimizable'
import { isRenditionSource } from '@/lib/documents/preview-types'
import type { FileItem } from './project-file-workspace'
import { formatBytes } from '@/lib/format'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { documentDragProps } from '../hooks/use-document-drag'
import { sourceTint } from '@/lib/ui/source-tint'
import { fileExtensionLabel, inferDocumentKind } from '../document-kind'
import { DocumentKindThumbnail } from './document-kind-thumbnail'
import { AuthorshipLine } from './authorship-line'
import { SourceDeletedNote } from '@/components/projects/source-deleted-note'
import { DocumentVersionStateBadge } from './document-version-badge'
import { RevisionCount, OlderRevisionBadge, isOlderRevisionEntry } from './revision-badge'
import { revisionCount } from '../lib/revision-chain'
import { documentBadgeState } from '../lib/document-lifecycle'
import { DocumentStatusBadge, isCitableStatus, isSettlingStatus } from './document-status'
import { BaseKnowledgeChip } from './base-knowledge-chip'
import { SemanticMatch } from './semantic-match'
import { useIngestFailureText } from './ingest-failure-notice'
import { FileTileBody, FileTileFooter, FileTileMedia, TileShell } from './file-tile'
import { FilingSuggestionSlot, useFilingHighlighted } from './filing-suggestion'
import { HIGHLIGHT_OUTLINE } from '@/components/ui/highlight'
import { Check } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { FileName } from './file-name'
import { OpenMarksChip } from './open-marks-chip'
import { MailThreadFileFacts, MailThreadThumbnail, listedFileName, useMailThreadKindLabel } from './mail-thread/mail-thread-file'

const SOURCE_TINT: Record<'project' | 'office', CSSProperties> = {
  project: sourceTint('project'),
  office: sourceTint('office'),
}

type ThumbState = 'loading' | 'ready' | 'none' | 'error'

const thumbnailCache = new Map<string, { url: Promise<string | null>; expiresAtMs?: number }>()

const EXPIRY_MARGIN_MS = 60_000

export function signedUrlExpiresAtMs(url: string): number | undefined {
  const exp = Number(new URL(url, 'http://relative.invalid').searchParams.get('exp'))
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined
}

export const resetThumbnailCache = (): void => {
  thumbnailCache.clear()
}

function loadThumbnail(fileId: string, provisional = false): Promise<string | null> {
  const existing = thumbnailCache.get(fileId)
  if (existing && !(existing.expiresAtMs !== undefined && Date.now() >= existing.expiresAtMs - EXPIRY_MARGIN_MS)) {
    return existing.url
  }
  const entry: { url: Promise<string | null>; expiresAtMs?: number } = { url: Promise.resolve(null) }
  const promise = fetch(`/api/documents/${fileId}/thumbnail`)
    .then((r) => {
      if (!r.ok) {
        if (r.status === 404) return null
        throw new Error(`thumbnail ${r.status}`)
      }
      return r.json()
    })
    .then((data) => (data && typeof data.url === 'string' ? data.url : null))
    .then((url) => {
      if (url === null && provisional) thumbnailCache.delete(fileId)
      if (url) entry.expiresAtMs = signedUrlExpiresAtMs(url)
      return url
    })
  promise.catch(() => thumbnailCache.delete(fileId))
  entry.url = promise
  thumbnailCache.set(fileId, entry)
  return promise
}

export function ThumbnailWithFallback({ file, visible = true }: { file: FileItem; visible?: boolean }) {
  const t = useTranslations(filesCopy)
  const kind = inferDocumentKind(file)
  const canHaveThumbnail =
    !file.mailThread &&
    file.contentType === 'application/pdf' ||
    (file.contentType ?? '').startsWith('image/') ||
    isRenditionSource(file)
  const [state, setState] = useState<ThumbState>(canHaveThumbnail ? 'loading' : 'none')
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!canHaveThumbnail) {
      setState('none')
      return
    }
    if (!visible) return
    let cancelled = false
    setState('loading')
    loadThumbnail(file.id, isSettlingStatus(file.status))
      .then((url) => {
        if (cancelled) return
        if (url) {
          setImgUrl(url)
          setState('ready')
        } else {
          setState('none')
        }
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [file.id, canHaveThumbnail, file.status, visible])

  if (state === 'ready' && imgUrl) {
    return (
      <Image
        src={imgUrl}
        alt=""
        fill
        sizes="(min-width: 1280px) 240px, (min-width: 768px) 33vw, 50vw"
        unoptimized={!isOptimizerEligible(imgUrl)}
        className="object-cover"
        onError={() => {
          thumbnailCache.delete(file.id)
          setState('error')
        }}
      />
    )
  }

  if (file.mailThread) return <MailThreadThumbnail />

  if (state === 'loading') {
    return <Skeleton className="absolute inset-0 h-full w-full rounded-none" data-testid="thumbnail-skeleton" />
  }

  const ext = fileExtensionLabel(file.filename)
  return (
    <DocumentKindThumbnail
      kind={kind}
      variant="fill"
      formatLabel={ext || t('thumbnail.image')}
      failed={state === 'error'}
      failedLabel={t('thumbnail.unavailable')}
    />
  )
}

export interface FileCardProps {
  file: FileItem
  isSelected: boolean
  onSelect: () => void
  locale: string
  match?: { snippet: string; page: number | null; query?: string | null }
  source?: 'project' | 'office' | null
  sourceLabel?: string
  ariaLabel?: string
  isBusy?: boolean
  footerLead?: ReactNode
  hideFooter?: boolean
  testId?: string
  actions?: ReactNode
  draggable?: boolean
  selection?: { checked: boolean }
  where?: string
}

function SelectionMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute right-3.5 top-3.5 z-[1] flex size-5 items-center justify-center rounded-inline border transition-colors duration-quick ease-out motion-reduce:transition-none',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-(--ds-line-strong) bg-background'
      )}
      data-testid="file-card-check"
      data-checked={checked ? '' : undefined}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

export const FileCard = memo(function FileCard({
  file,
  isSelected,
  onSelect,
  locale,
  match,
  source,
  sourceLabel,
  ariaLabel,
  isBusy,
  footerLead,
  hideFooter,
  testId = 'file-card',
  actions,
  draggable = false,
  selection,
  where,
}: FileCardProps) {
  const t = useTranslations(filesCopy)
  const name = listedFileName(file)
  const thread = Boolean(file.mailThread)
  const threadLabel = useMailThreadKindLabel()
  const ext = thread ? '' : fileExtensionLabel(file.filename)
  const hasSize = !thread && typeof file.fileSize === 'number'
  const isFailed = file.status === 'failed'
  const failureText = useIngestFailureText(isFailed ? file.errorMessage : null)
  const failureReason = isFailed ? (failureText?.sentence ?? t('ingestFailure.unknown')) : undefined
  const showStatus = !!file.status && !isCitableStatus(file.status)
  const showSummary = !match && !isFailed && Boolean(hideFooter)
  const isAwaitingSummary = showSummary && !file.summary && isSettlingStatus(file.status)
  const [mediaRef, seen] = useSeenOnce<HTMLDivElement>()
  const lit = useFilingHighlighted(file.id)

  return (
    <TileShell
      interactive
      className={cn(
        'group/card',
        (isSelected || selection?.checked) && 'bg-selected',
        isBusy && 'cursor-progress opacity-70',
        lit && HIGHLIGHT_OUTLINE
      )}
      {...(draggable && !selection ? documentDragProps(file.id, file.folderId ?? null) : {})}
    >
      {selection && <SelectionMark checked={selection.checked} />}
      {/* What is open on the pages, on the sheet beside what is in progress, as the list puts both after the name:
          one place. Over the thumbnail's foot (above „Wird gelesen“ when that is there), outside the card's button,
          since it is a press of its own that opens the review. A line of its own under the summary left every other
          tile of its row a 50px hole. */}
      <div className={cn('absolute left-3.5 z-[1] max-w-[calc(100%-1.75rem)]', showStatus ? 'top-[78px]' : 'top-[102px]')}>
        <OpenMarksChip file={file} name={name} className="bg-background hover:bg-desk" />
      </div>
      {actions && !selection && (
        <div
          className="absolute right-0.5 top-[133px] z-[1] pointer-coarse:opacity-100 md:opacity-0 md:group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity duration-quick ease-out motion-reduce:transition-none"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      )}
      {/* `aria-current`, not `aria-pressed`: pressing this OPENS the file, it
          does not toggle anything. The card used to close the preview when you
          clicked the row you were already looking at — the one surface in the
          product that did — and `aria-pressed` was at least honest about that.
          The behaviour was the bug; a row opens, and closing is the overlay's
          job. `aria-current` says the remaining true thing: this is the one on
          screen. */}
      <button data-attr="files-select"
        type="button"
        onClick={onSelect}
        aria-current={isSelected && !selection ? 'true' : undefined}
        aria-pressed={selection ? selection.checked : undefined}
        aria-label={ariaLabel}
        aria-busy={isBusy}
        data-testid={testId}
        className={cn("group relative flex w-full min-w-0 flex-col overflow-visible text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", hideFooter && "flex-1")}
      >
        {/* The tile is on the page, no white block: a row's leftover height goes
            BELOW the meta line (the footer grows), so every meta line of a row
            shares one baseline whatever each card carries above it. Without a
            footer the body takes it. */}
        {/* Nothing above the sheet clips: its edge is a ring drawn 1px outside it, and a clip cut it to the corners. */}
        <FileTileBody className={cn('overflow-visible p-0', hideFooter && 'flex-1 rounded-none')}>
          {/* Under the hover, the open and the picked tile's fill the sheet takes that fill: the one grey on the state grey was grey on grey. */}
          <FileTileMedia
            ref={mediaRef}
            className="h-[124px]"
          >
            <ThumbnailWithFallback file={file} visible={seen} />
            {showStatus && (
              <DocumentStatusBadge
                status={file.status}
                queueAhead={file.queueAhead}
                        className="absolute bottom-2 left-2 h-5 max-w-[calc(100%-1rem)] border-transparent bg-background px-1.5 py-0 text-[11px] font-medium leading-none"
              />
            )}
          </FileTileMedia>

          {/* On the sheet's edge, no inset of its own; the meta line follows right under the name. */}
          <div className="pt-2.5">
            {/* Provenance, where a surface mixes stores (the Archiv): a signal, so it keeps its colour and its word. */}
            {source && sourceLabel && (
              <span
                className="mb-1.5 inline-flex shrink-0 items-center rounded-control px-2 py-[3px] text-xs font-semibold leading-none tracking-[0.02em]"
                style={SOURCE_TINT[source]}
              >
                {sourceLabel}
              </span>
            )}

            {/* The name the document goes by. The format chip beside it still
                comes from the FILE name, because that is what the bytes are —
                a rename changes the label, never the format. */}
            {/* Two lines at most, whole and broken between words, else cut in the middle (`FileName`, findings 5 and 17).
                The first line leaves its end to the ⋯, which stands there; the second has the whole width. */}
            <p className="text-name text-foreground min-w-0">
              <FileName text={name} lines={2} firstLineInset={actions && !selection ? TILE_ACTIONS_INSET : 0} />
            </p>
            {/* A byline, directly under the name — who WROTE this. It is not in
                the footer, because the footer is where the faces and the word
                `Unvergeben` live and that slot answers a different question:
                who is responsible for it. */}
            <AuthorshipLine authoredBy={file.authoredBy} className="mt-0.5" />
            {file.sourceDeletedAt && <SourceDeletedNote at={file.sourceDeletedAt} className="mt-0.5" />}
            {/* The editorial state, on the same side as the byline and nowhere
                near the footer, for exactly that reason: „freigegeben" is a
                statement about the CONTENT and „Unvergeben" one about
                responsibility (ADR-0047's addendum, ADR-0054). Silent without a
                history: one version distinguishes nothing, so the badge appears
                only once a second version exists — even for a draft the agent wrote. */}
            {/* An older Fassung says that and only that: „Ersetzt" beside it
                was the same fact twice, without saying by what. A current one
                carries its approval state and, after it as quiet text rather
                than a second badge, „3 Fassungen": the history is not a state.
                On a 220px card the count beside the name cut the name in half,
                so here it rides on this line; the list puts it by the name. */}
            {/* A Verlauf's Fassungen are its mails: it says how many and when the last came, never a Freigabe state
                nobody gave it. */}
            {thread ? (
              <div className="mt-1 flex min-h-5 min-w-0 items-center">
                <MailThreadFileFacts file={file} className="truncate" />
              </div>
            ) : isOlderRevisionEntry(file) ? (
              <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5">
                <OlderRevisionBadge file={file} />
              </div>
            ) : (
              (documentBadgeState({ versionState: file.versionState, versionCount: file.versionCount, authoredBy: file.authoredBy }) !== null || revisionCount(file) > 1) && (
                <div className="mt-1 flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {(file.versionCount ?? 0) > 1 && (
                    <DocumentVersionStateBadge
                      versionState={file.versionState}
                      versionCount={file.versionCount}
                      authoredBy={file.authoredBy}
                    />
                  )}
                  <RevisionCount file={file} />
                </div>
              )
            )}
            {match ? (
              <SemanticMatch snippet={match.snippet} page={match.page} query={match.query} />
            ) : isFailed ? (
              <p
                className="mt-1 line-clamp-1 text-xs leading-normal text-destructive"
                title={failureText?.raw ?? failureReason}
                data-testid="file-card-failure"
              >
                {failureReason}
              </p>
            ) : isAwaitingSummary ? (
              <div className="mt-[7px] space-y-[7px]" aria-hidden data-testid="file-card-summary-skeleton">
                <Skeleton className="h-[7px] w-full rounded-surface" />
                <Skeleton className="h-[7px] w-[58%] rounded-surface" />
              </div>
            ) : (
              showSummary && file.summary && (
                <p className="mt-1 line-clamp-2 text-xs leading-normal text-muted-foreground" title={file.summary}>
                  {file.summary}
                </p>
              )
            )}
          </div>
        </FileTileBody>
      </button>
      {/* The footer is the button's sibling, not its child: it carries
          the agent's filing chip, a button of its own, on the left, and a button
          cannot hold a button. A click on the rest of it opens the file as the
          card does; the keyboard opens it through the card's button.
          Its height is the same with a chip or without one (the chip's margin
          box is a line of text), so a row of tiles stays even when a
          suggestion arrives or goes. On a narrow tile the chip's folder name
          ellipsizes first, then the relative time drops; it never wraps.
          The meta line follows the name directly: a tile is one unit read top
          down, and holding every meta line of a row on one baseline opened a
          24px hole under each one-line name beside a two-line one. */}
      {!hideFooter && (
        <FileTileFooter
          onClick={onSelect}
          className="@container/foot group/foot cursor-pointer flex-wrap items-start justify-start gap-1.5 pt-0.5 text-xs text-muted-foreground"
          data-testid="file-card-footer"
        >
          {/* Left, under the name: one edge for everything on the tile. */}
          <span className="flex min-w-0 items-center gap-1.5 empty:hidden">
            <FilingSuggestionSlot documentId={file.id} className="min-w-[4.5rem]" />
            {/* A link of its own, so it sits here beside the card's button and never inside it. */}
            <BaseKnowledgeChip file={file} />
            {/* Who has it, then the facts, one line joined by the dot: „Unvergeben PNG“ read as one phrase. */}
            {footerLead}{footerLead && <FactDot />}
          </span>
          {/* Where it lies, a line of its own over the facts: on one line with them „Berichte“ was cut to „Beric…“. */}
          {where && <span className="order-first min-w-0 basis-full truncate" title={where} data-testid="file-card-where">{where}</span>}
          {/* On a 156px card the size and the age are about 125px, so the
              phone's card keeps 10px of padding (the title's too) and a tighter
              gap: the age used to run into the edge the title keeps clear. */}
          <span className="flex shrink-0 items-center gap-1" /* the dot's 4px each side: the width of the bound text join (`CLAUSE_JOIN`) */>
            {/* The format in words, with the facts: a type is not a signal, so it is ink like them, never a tinted chip. */}
            {thread && <span className="font-medium" data-testid="file-card-kind">{threadLabel}</span>}
            {ext !== '' && <span className="font-medium uppercase tracking-wide">{ext}</span>}
            {hasSize && (
              <>
                {ext !== '' && <FactDot />}
                <span className="tabular-nums">{formatBytes(file.fileSize, locale)}</span>
              </>
            )}
            <span className="flex items-center gap-1 group-has-[[data-slot=filing-chip]]/foot:@max-[14rem]/foot:hidden">
              {(ext !== '' || hasSize || thread) && <FactDot />}
              <TimeAgo date={file.createdAt} locale={locale} className="tabular-nums" />
            </span>
          </span>
        </FileTileFooter>
      )}
    </TileShell>
  )
})

const TILE_ACTIONS_INSET = 24

function FactDot(): JSX.Element {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  )
}
