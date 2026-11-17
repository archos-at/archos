'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AlertCircle, FileText } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { documentDisplayName } from '@/lib/documents/display-name'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Spinner } from '@/components/ui/spinner'
import { useFileFacts } from '../hooks/use-file-facts'
import { FileExtChip } from './file-ext-chip'
import { DockedSplit } from '@/components/ui/docked-split'
import { useSettlingRefresh } from '../hooks/use-settling-refresh'
import type { DocumentScope } from './document-actions'
import { PeekActions } from './file-preview-peek-actions'
import { failedWithPreviousVersion, isCitableStatus, isFailedStatus, isSettlingStatus } from './document-status'
import { FilePreviewPane } from './file-preview-pane'
import { fileItemFromStatus } from '../lib/document-question'
import { refreshedFileFields } from '../lib/file-item'
import { STATUS_FIELDS } from '../lib/document-status-reads'
import { peekHasRoom } from '../lib/peek-room'
import type { FileItem } from './project-file-workspace'
import {
  defaultPeekWidth,
  FILE_PEEK_WIDTH_MAX,
  FILE_PEEK_WIDTH_MIN,
  useFilePreviewStore,
} from '../stores/file-preview-store'

export const METADATA_GRACE_POLLS = 3

type StatusBody = Parameters<typeof fileItemFromStatus>[0]

export function FilePreviewHost({
  presentation,
}: {
  presentation?: 'split'
} = {}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const file = useFilePreviewStore((state) => state.file)
  const mode = useFilePreviewStore((state) => state.mode)
  const hidden = useFilePreviewStore((state) => state.hidden)
  const context = useFilePreviewStore((state) => state.context)
  const close = useFilePreviewStore((state) => state.close)
  const hide = useFilePreviewStore((state) => state.hide)
  const peek = useFilePreviewStore((state) => state.peek)
  const expand = useFilePreviewStore((state) => state.expand)
  const peekWidth = useFilePreviewStore((state) => state.peekWidth)
  const handoff = useFilePreviewStore((state) => state.handoff)
  const endHandoff = useFilePreviewStore((state) => state.endHandoff)
  const patchFile = useFilePreviewStore((state) => state.patchFile)
  const fileId = file?.id ?? null
  const fileStatus = file?.status ?? null
  const fileSummary = file?.summary ?? null
  const [metadataGrace, setMetadataGrace] = useState<{ id: string; left: number } | null>(null)
  const awaitingMetadata =
    fileId !== null &&
    metadataGrace?.id === fileId &&
    metadataGrace.left > 0 &&
    isCitableStatus(fileStatus) &&
    fileSummary === null
  const settlingItems = useMemo(
    () => (fileId ? [{ status: fileStatus, pending: awaitingMetadata }] : []),
    [fileId, fileStatus, awaitingMetadata],
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const [arriving, setArriving] = useState(false)
  const onChat = Boolean(pathname?.includes('/chat'))
  const inSplit = presentation === 'split'
  const carrying = handoff && !onChat
  const overlay = mode === 'modal' || (mode === 'expanded' && onChat && !hidden) || carrying
  const peeking =
    inSplit || (mode === 'peek' && peekHasRoom(pathname, isMobile) && !hidden)
  const chromeVisible = file !== null && (overlay || peeking)
  const parked = file !== null && !chromeVisible

  useEffect(() => {
    if (handoff && onChat) endHandoff()
  }, [handoff, onChat, endHandoff])

  const lastArrival = useRef<string | null>(null)
  useEffect(() => {
    const arrival = peeking && fileId ? fileId : null
    if (arrival && arrival !== lastArrival.current) setArriving(true)
    lastArrival.current = arrival
  }, [peeking, fileId])

  useEffect(() => {
    if (!chromeVisible || !overlay) return
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      const layer = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="alertdialog"]') : null
      if (layer && layer !== panelRef.current) return
      if (event.key === 'Escape') {
        if (mode === 'expanded') peek()
        else close()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement
      if (event.shiftKey && (activeEl === first || activeEl === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [chromeVisible, overlay, mode, close, peek])

  useEffect(() => {
    if (chromeVisible) return
    const opener = openerRef.current
    if (opener?.isConnected) opener.focus()
  }, [chromeVisible])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (parked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [parked])

  const refreshStatus = useCallback(async () => {
    const id = fileId
    if (!id) return
    try {
      const res = await fetch(`/api/documents/${id}/status`)
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!data || typeof data !== 'object') return
      const body = data as Record<string, unknown>
      if (typeof body.status !== 'string') return
      const current = useFilePreviewStore.getState().file
      if (current?.id !== id) return
      const fresh = fileItemFromStatus({ ...(body as StatusBody), id, filename: current.filename })
      const fields = STATUS_FIELDS.filter((field) => field in body)
      const patch = refreshedFileFields(current, fresh, fields)
      if (patch) patchFile(patch)
      const summary = patch && 'summary' in patch ? patch.summary : current.summary
      if (isSettlingStatus(body.status)) {
        setMetadataGrace(null)
      } else if (isCitableStatus(body.status) && summary == null) {
        setMetadataGrace((prev) =>
          prev?.id === id ? { id, left: prev.left - 1 } : { id, left: METADATA_GRACE_POLLS },
        )
      }
    } catch {
      // Offline or a hiccup — the poll's next tick asks again.
    }
  }, [fileId, patchFile])
  useSettlingRefresh(settlingItems, refreshStatus)

  if (!file) return null

  const name = documentDisplayName(file)
  const panePresentation = carrying
    ? 'modal'
    : mode === 'peek'
      ? 'peek'
      : mode === 'expanded'
        ? 'expanded'
        : 'modal'

  return (
    <>
      {chromeVisible && overlay && (
        <div
          className="bg-overlay animate-in fade-in-0 fixed inset-0 top-[var(--page-inset-top,0px)] left-[var(--page-inset-start,0px)] z-50 backdrop-blur-sm duration-quick ease-out motion-reduce:animate-none"
          onClick={mode === 'expanded' ? peek : close}
          aria-hidden
        />
      )}
      <div
        ref={panelRef}
        role={parked ? undefined : peeking ? 'complementary' : 'dialog'}
        aria-modal={chromeVisible && overlay ? true : undefined}
        aria-label={parked ? undefined : t('preview.dialogLabel', { name })}
        aria-hidden={parked || undefined}
        tabIndex={parked ? undefined : -1}
        data-testid="file-preview-host"
        data-mode={parked ? 'parked' : peeking ? 'peek' : mode}
        onAnimationEnd={() => setArriving(false)}
        onKeyDown={
          peeking
            ? (event) => {
                if (event.key !== 'Escape') return
                event.stopPropagation()
                dismissPeek(hide)
              }
            : undefined
        }
        className={cn(
          'flex flex-col overflow-hidden outline-none',
          parked &&
            'invisible pointer-events-none fixed top-0 left-[-120vw] z-[-1] h-[80dvh]',
          peeking && 'group h-full min-h-0 min-w-0 bg-card',
          peeking && !inSplit && 'border-l border-border',
          peeking &&
            arriving &&
            'animate-in fade-in-0 slide-in-from-right-4 duration-deliberate ease-entrance motion-reduce:animate-none',
          !parked && !peeking && 'group z-40',
          !parked &&
            !peeking &&
            'bg-popover text-popover-foreground fixed left-[calc(50%+var(--page-inset-start,0px)/2)] top-[calc(50%+var(--page-inset-top,0px)/2)] z-50 h-[min(85dvh,calc(100dvh-var(--page-inset-top,0px)-2rem))] w-[min(960px,calc(100%-var(--page-inset-start,0px)-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-overlay shadow-lg',
          !parked &&
            !peeking &&
            'phone:inset-0 phone:h-dvh phone:w-full phone:translate-x-0 phone:translate-y-0 phone:rounded-none phone:border-0 phone:shadow-none',
          !parked && !peeking && 'animate-in fade-in-0 zoom-in-95 duration-base ease-entrance motion-reduce:animate-none',
        )}
        style={{
          width: parked || (peeking && !inSplit) ? peekWidth : undefined,
        }}
      >
        {peeking && (
          <PeekToolbar
            file={file}
            scope={context.scope ?? 'files'}
            name={name}
            onExpand={expand}
            onHide={hide}
          />
        )}
        <FilePreviewPane
          file={file}
          projectId={context.projectId}
          projectName={context.projectName}
          canManage={context.canManage}
          scope={context.scope}
          canCollaborate={context.canCollaborate}
          lifecyclePermissions={context.lifecyclePermissions}
          viewerUserId={context.viewerUserId}
          showModels={context.showModels}
          presentation={panePresentation}
          onClose={overlay ? (mode === 'expanded' ? peek : close) : hide}
          onRenamed={(fileId, displayName) => {
            if (fileId === file.id) patchFile({ displayName })
            context.onRenamed?.(fileId, displayName)
          }}
          onDeleted={(fileId) => {
            if (fileId === file.id) close()
            context.onDeleted?.(fileId)
          }}
          onReingested={(fileId, status) => {
            if (fileId === file.id) patchFile({ status })
            context.onReingested?.(fileId, status)
          }}
          onTagsUpdated={(fileId, tags, topics) => {
            if (fileId === file.id) patchFile(topics === undefined ? { tags } : { tags, topics })
            context.onTagsUpdated?.(fileId, tags, topics)
          }}
          onOpenDocument={context.onOpenDocument}
          onRevisionChanged={(fileId, revision) => {
            if (fileId === file.id) patchFile({ revision })
            context.onRevisionChanged?.(fileId, revision)
          }}
          onAssigneesChanged={(assignees) => patchFile({ assignees })}
          onLifecycleChanged={(fileId, summary) => {
            if (fileId === file.id) patchFile(summary)
            context.onLifecycleChanged?.(fileId, summary)
          }}
          onMarksChanged={(fileId, marks) => {
            if (fileId === file.id) patchFile({ marks })
            context.onMarksChanged?.(fileId, marks)
          }}
        />
      </div>
    </>
  )
}

export type FilePeekPlacement = 'beside' | 'dismissed' | 'away'

export function useFilePeekPlacement(): FilePeekPlacement {
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const file = useFilePreviewStore((state) => state.file)
  const mode = useFilePreviewStore((state) => state.mode)
  const hidden = useFilePreviewStore((state) => state.hidden)

  const roomForIt = file !== null && mode === 'peek' && peekHasRoom(pathname, isMobile)
  if (!roomForIt) return 'away'
  return hidden ? 'dismissed' : 'beside'
}

export function useFilePeekBesideChat(): boolean {
  return useFilePeekPlacement() === 'beside'
}

function FilePreviewSplit({
  split,
  children,
}: {
  split: boolean
  children: ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const peekWidth = useFilePreviewStore((state) => state.peekWidth)
  const setPeekWidth = useFilePreviewStore((state) => state.setPeekWidth)
  const restorePeekWidth = useFilePreviewStore((state) => state.restorePeekWidth)
  const hide = useFilePreviewStore((state) => state.hide)
  const peek = useFilePreviewStore((state) => state.peek)
  const dismissed = useFilePeekPlacement() === 'dismissed'

  return (
    <DockedSplit
      id="file-ask"
      side="end"
      open={split}
      width={peekWidth}
      minWidth={FILE_PEEK_WIDTH_MIN}
      maxWidth={FILE_PEEK_WIDTH_MAX}
      defaultWidth={defaultPeekWidth}
      onWidthChange={setPeekWidth}
      onDismiss={hide}
      restoreWidth={restorePeekWidth}
      resizeLabel={t('preview.resizePeek')}
      restore={dismissed ? { label: t('assignment.showFile'), onRestore: peek, testId: 'file-peek-restore' } : null}
      panel={<FilePreviewHost presentation={split ? 'split' : undefined} />}
    >
      {children}
    </DockedSplit>
  )
}

export function FilePreviewBridge({ children }: { children: ReactNode }): JSX.Element {
  const split = useFilePeekBesideChat()
  return <FilePreviewSplit split={split}>{children}</FilePreviewSplit>
}

function dismissPeek(hide: () => void): void {
  hide()
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-testid="composer-show-file"]')?.focus()
  })
}

function PeekToolbar({
  file,
  scope,
  name,
  onExpand,
  onHide,
}: {
  file: FileItem
  scope: DocumentScope
  name: string
  onExpand: () => void
  onHide: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const facts = useFileFacts(file)
  const showDetails = useFilePreviewStore((state) => state.setPeekDetails)
  return (
    <>
    {/* Held 10px off the top, the band the chat's own pills occupy
        (`ChatToolbar`: `pt-2.5` + `min-h-12`), so the file's name and the
        session's title sit on one line across the seam. */}
    <div className="mt-2.5 flex min-h-12 shrink-0 items-center gap-2.5 pr-3 pb-2.5 pl-4">
      <FileExtChip filename={file.filename} size="sm" fallback={<FileText className="size-3.5" />} />
      <div className="min-w-0 flex-1">
        <p
          className="text-foreground truncate text-sm font-medium leading-tight"
          title={name}
        >
          {name}
        </p>
        {facts && (
          <p
            data-testid="file-peek-facts"
            className="text-muted-foreground mt-0.5 truncate text-xs tabular-nums"
          >
            {facts}
          </p>
        )}
      </div>
      <PeekActions file={file} scope={scope} onExpand={onExpand} onClose={() => dismissPeek(onHide)} />
    </div>
    {/* A STRIP, not a chip beside the name.
        The status has to be here at all: a peek exists because this file is
        what the next question is about, and a document still being read (or
        one that failed) is a document the agent cannot cite — the modal has
        said so under the name since it was built, and the peek, the surface
        whose whole reason is that sentence, said nothing.
        It is a strip because the row above is 280px at its narrowest and a
        badge in it left "Brandschutzp…" beside "Wird verarbeitet": the
        identity truncated to make room for a word whose CONSEQUENCE — the
        answer will not use this file — fitted nowhere but a tooltip. On its
        own line both fit, and the sentence is the part that matters.
        Nothing at all for a citable file: quiet chrome is the point of the
        peek, and a badge that says "fine" on every document is a badge nobody
        reads when it says something else. */}
    {!isCitableStatus(file.status) && (
      <div
        role="status"
        className={cn(
          'mx-3 mb-2.5 flex shrink-0 items-start gap-2 rounded-control border px-3 py-2 text-xs',
          isFailedStatus(file.status)
            ? 'border-destructive/25 bg-destructive/[0.05]'
            : 'border-base bg-surface-sunken',
        )}
      >
        {/* ONE carrier of state per strip. A solid destructive badge on a
            destructive ground said "failed" twice and shouted the second time,
            next to the control the reader actually needs; and a badge plus a
            sentence that already names the state is the same word rendered at
            two weights. So the mark is a mark: a spinner while the document is
            being read — which is the honest answer to "what do I do about
            this", since the answer is "nothing, it is happening" — and an alert
            glyph when it will not resolve on its own. */}
        {isFailedStatus(file.status) ? (
          <AlertCircle className="text-destructive mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <Spinner size="xs" aria-hidden className="text-muted-foreground mt-0.5 shrink-0" />
        )}
        <p className="text-muted-foreground min-w-0 flex-1 text-pretty leading-snug">
          {/* A failed NEW version is not a file the agent cannot cite: the
              previous version's passages stay in the index, so the sentence
              that says "cannot cite" would be wrong about the one thing the
              strip exists to say. Same rule as the pane's failure panel. */}
          {failedWithPreviousVersion(file)
            ? t('preview.peekFailedPreviousVersionHint')
            : isFailedStatus(file.status)
              ? t('preview.peekFailedHint')
              : t('preview.peekIndexingHint')}
        </p>
        {/* NO DEAD ENDS. "the agent cannot cite this file" was a statement with
            nothing after it — the worst kind of message, because it tells the
            reader the question they are about to ask is already compromised
            and then leaves them holding it. The details are where this
            document's own account of the failure lives: the ingestion error in
            full, and the retry for whoever may run it. So the strip opens them, as ⓘ does.
            The indexing case needs no control — it resolves itself, and the
            poll above is what makes that visible. */}
        {isFailedStatus(file.status) && (
          <button data-attr="files-expand"
            type="button"
            onClick={() => showDetails(true)}
            className={cn(
              'text-foreground hover:bg-hover flex h-7 shrink-0 items-center rounded-full px-2 font-medium underline-offset-2 hover:underline',
              FOCUS_RING,
            )}
          >
            {t('preview.peekFailedAction')}
          </button>
        )}
      </div>
    )}
    </>
  )
}
