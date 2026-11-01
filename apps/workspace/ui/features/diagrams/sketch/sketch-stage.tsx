'use client'

/**
 * A Skizze in its review (ADR-0148): the Excalidraw canvas where a PDF's pages
 * would be, inside the same `DocumentReviewMode` as every document. The review
 * keeps the header (name, Fassung, „Ersetzt …“, the open marks, who is here),
 * the list, the cards, the Protokoll and Piloti; this stage brings the canvas,
 * its marks on their elements, the page it is traced over, the live strokes
 * and „Als neue Fassung speichern“ in the review's header.
 *
 * Provided through the documents feature's slot (`features/documents/preview-actions.tsx`),
 * so documents imports nothing of diagrams. The canvas is loaded with
 * `next/dynamic` when the review opens, never before (ADR-0141,
 * `sketch-isolation.spec.ts`).
 *
 * The room is the review's (`review.room`), so the tab is in it once and the
 * review's Presence is the one presence. A save refused because someone saved
 * first merges their Fassung in and tries once more; during Freigabe a writer
 * saves into the open draft; while a version is in review nothing is saved and
 * the canvas stays live („Weiterzeichnen“).
 *
 * Keys: the canvas is marked `data-stage-keys`, and the review's letters and
 * its Escape yield there, so V, R, E, ⌫ and Esc are Excalidraw's while focus is
 * in the drawing. Closing with unsaved strokes asks once, here (`setCloseGuard`):
 * Excalidraw keeps no draft of its own.
 */

import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { getSketch, type SketchForEditing } from '@/adapters/api/diagrams-client'
import type { WireElement } from '@/lib/diagrams/sketch-room-types'
import type { RealtimePeer } from '@/lib/realtime/types'
import { documentFileUrl } from '@/lib/documents/urls'
import type { ReviewStageProps } from '@/features/documents/preview-actions'
import { ReviewPageLayer, type ReviewDraft } from '@/features/documents/sketch-review'
import { Button } from '@/components/ui/button'
import { FloatingNote } from '@/components/ui/floating-toolbar'
import { useLocale, useTranslations } from '@/i18n'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { useDiagramTheme } from '../use-diagram-theme'
import type { SketchCanvasHandle } from './sketch-canvas'
import { CanvasLoading } from './sketch-loading'
import { SketchPins } from './sketch-pins'
import { UnderlayBanner } from './sketch-underlay'
import type { UnderlayLoadState } from './sketch-underlay-load'
import type { SketchViewApi } from './sketch-view'
import { useSketchRevision, type SavedRevision, type SketchRevisionState } from './use-sketch-revision'
import { useSketchRoom, type SketchRoom } from './use-sketch-room'

const SketchCanvas = dynamic(() => import('./sketch-canvas'), {
  ssr: false,
  loading: ({ error }) => <CanvasLoading error={error} />,
})

/** What a save came to, said once at the top of the canvas. */
function RevisionStatus({ state }: { state: SketchRevisionState }) {
  const t = useTranslations(diagramsCopy)
  if (state.kind === 'saved') {
    return (
      <span>
        {t(state.draft ? 'sketch.savedDraft' : 'sketch.savedVersion', { number: String(state.versionNumber) })}
        {state.pdfStale ? <span data-testid="sketch-pdf-stale"> {t('sketch.pdfStale')}</span> : null}
      </span>
    )
  }
  if (state.kind === 'stale') {
    return <span className="text-destructive">{t(state.merged ? 'sketch.saveAgain' : 'sketch.staleVersion')}</span>
  }
  if (state.kind === 'failed') return <span className="text-destructive">{state.message}</span>
  if (state.kind === 'review_open') {
    return (
      <span className="text-destructive" data-testid="sketch-review-open">
        {t('sketch.reviewOpen')}
      </span>
    )
  }
  return null
}

/** What the room says: another's save, and an element too large to share live. */
function RoomStatus({ room }: { room: SketchRoom }) {
  const t = useTranslations(diagramsCopy)
  const { peerSave, tooLarge, refused } = room
  return (
    <>
      {peerSave ? (
        <span data-testid="sketch-peer-saved">
          {t(peerSave.matches ? 'sketch.peerSaved' : 'sketch.peerSavedDiffers', { name: peerSave.by.name })}
        </span>
      ) : null}
      {tooLarge.length > 0 ? <span> {t('sketch.tooLargeLive')}</span> : null}
      {refused.length > 0 ? <span> {t('sketch.refusedLive')}</span> : null}
    </>
  )
}

/** An SVG Piloti filed without a scene (a flow, a Gliederung): its picture, with its marks over it. */
function SheetOnly({ documentId, review }: Pick<ReviewStageProps, 'documentId' | 'review'>) {
  return (
    <div className="flex size-full items-center justify-center overflow-auto p-6" data-testid="sketch-stage-sheet">
      <div className="relative">
        {/* oxlint-disable-next-line next/no-img-element -- the document's own bytes, sized by the browser as in the preview */}
        <img src={documentFileUrl(documentId)} alt="" className="block max-h-[80dvh] w-auto" />
        <div className="absolute inset-0">
          <ReviewPageLayer page={1} review={review} focused />
        </div>
      </div>
    </div>
  )
}

/** The stage: reads the Skizze as it is now (a read the download log records: the person opened the drawing). */
export function SketchStage(props: ReviewStageProps) {
  const { documentId } = props
  const [read, setRead] = useState<{ state: 'loading' } | { state: 'failed'; notASketch: boolean } | { state: 'ready'; sketch: SketchForEditing }>({ state: 'loading' })
  const [reads, setReads] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setRead({ state: 'loading' })
    getSketch(documentId, controller.signal).then(
      (sketch) => setRead({ state: 'ready', sketch }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        const status = (error as { status?: number }).status
        setRead({ state: 'failed', notASketch: status === 415 })
      }
    )
    return () => controller.abort()
  }, [documentId, reads])
  if (read.state === 'loading') return <CanvasLoading />
  if (read.state === 'failed') {
    return read.notASketch ? <SheetOnly documentId={documentId} review={props.review} /> : <CanvasLoading error={new Error('unreadable')} />
  }
  // Moved onto the base's newer Fassung: the stage reads the Skizze again and opens on it.
  const reopen = () => {
    props.onChanged()
    setReads((count) => count + 1)
  }
  return <SketchEditor key={read.sketch.versionId ?? 'unversioned'} {...props} sketch={read.sketch} onReopen={reopen} />
}

function SketchEditor({
  review,
  canPickAssignee,
  onChanged,
  headerSlot,
  setCloseGuard,
  close,
  cardsDocked,
  sketch,
  onReopen,
}: ReviewStageProps & { sketch: SketchForEditing; onReopen: () => void }) {
  const t = useTranslations(diagramsCopy)
  const { locale } = useLocale()
  const theme = useDiagramTheme()
  const handle = useRef<SketchCanvasHandle | null>(null)
  const [api, setApi] = useState<SketchViewApi | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState<false | { others: string[] }>(false)
  const canWrite = sketch.canWrite
  const saveTarget = sketch.saveTarget ?? 'published'

  const nameOf = useCallback(
    (peer: RealtimePeer) => (peer.forName ? t('sketch.agentFor', { name: peer.name, forName: peer.forName }) : peer.name),
    [t]
  )
  const room = useSketchRoom({ documentId: sketch.documentId, canWrite, baseVersionId: sketch.versionId, nameOf, room: review.room })
  const roomRef = useRef(room)
  roomRef.current = room
  const baseOf = useCallback(() => roomRef.current.base(), [])
  const peerOf = useCallback(() => roomRef.current.peerId, [])
  // The open draft's hash this canvas sits on: what it opened, then what its own save or a merge read.
  const draftHash = useRef<string | null>(sketch.contentHash ?? null)
  const hashOf = useCallback(() => draftHash.current, [])
  /** Someone saved first: their Fassung is merged into this canvas, and the save is tried once more on it. */
  const resolveStale = useCallback(async () => {
    const latest = await getSketch(sketch.documentId).catch(() => null)
    if (!latest) return false
    draftHash.current = latest.contentHash
    roomRef.current.mergeFrom(latest.scene.elements as unknown as WireElement[], latest.versionId)
    return true
  }, [sketch.documentId])
  const onRevisionSaved = useCallback(
    (saved: SavedRevision) => {
      handle.current?.markSaved()
      if (saved.state === 'draft') draftHash.current = saved.contentHash
      void roomRef.current.announceSave(saved.versionId, saved.elements as unknown as WireElement[])
      onChanged()
    },
    [onChanged]
  )
  // Another writer saved what this canvas shows: nothing here is unsaved any more. Saved something
  // else (an agent's change, a delta this canvas missed): its Fassung is merged in at once.
  const { peerSave } = room
  const resolveStaleRef = useRef(resolveStale)
  resolveStaleRef.current = resolveStale
  useEffect(() => {
    if (!peerSave) return
    if (peerSave.matches) handle.current?.markSaved()
    else void resolveStaleRef.current()
  }, [peerSave])

  const prepareSketch = useCallback(async () => {
    if (!handle.current) throw new Error('the canvas is not ready')
    return handle.current.prepare()
  }, [])
  const revised = useSketchRevision(
    { documentId: sketch.documentId, baseVersionId: baseOf, peerId: peerOf, baseContentHash: hashOf },
    prepareSketch,
    onRevisionSaved,
    resolveStale
  )
  const saving = revised.state.kind === 'saving'

  // A mark on a selection: its elements must be in the saved Fassung, so unsaved work is saved first.
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((next: boolean) => {
    dirtyRef.current = next
    setDirty(next)
  }, [])
  const { save: saveRevision } = revised
  const annotate = useCallback(
    async (draft: ReviewDraft) => {
      if (dirtyRef.current) await saveRevision()
      if (!dirtyRef.current) review.setDraft(draft)
    },
    [saveRevision, review]
  )
  // The review asks before it closes: unsaved strokes are asked about once, here.
  useEffect(() => {
    setCloseGuard(() => {
      if (!dirtyRef.current) return true
      setConfirmingDiscard({ others: roomRef.current.otherPeople() })
      return false
    })
    return () => setCloseGuard(null)
  }, [setCloseGuard])
  const onReady = useCallback((ready: SketchCanvasHandle) => {
    handle.current = ready
  }, [])
  const [underlayShown, setUnderlayShown] = useState<boolean | null>(null)
  const onUnderlay = useCallback((state: UnderlayLoadState) => setUnderlayShown(state === 'shown'), [])

  const headerActions = (
    <>
      {revised.state.kind === 'review_open' ? (
        <Button variant="ghost" size="sm" onClick={revised.dismiss} data-testid="sketch-keep-drawing">
          {t('sketch.keepDrawing')}
        </Button>
      ) : null}
      {canWrite ? (
        <Button
          size="sm"
          onClick={() => void revised.save()}
          disabled={saving}
          data-testid="sketch-save"
          title={t(saveTarget === 'draft' ? 'sketch.reviseDraftDescription' : saveTarget === 'review_open' ? 'sketch.reviewOpenDescription' : 'sketch.reviseDescription')}
        >
          <Save className="size-3.5" aria-hidden />
          {/* On a phone the glyph carries it; the words stay for a screen reader. */}
          <span className="max-sm:sr-only">{t(saving ? 'sketch.savingVersion' : 'sketch.saveVersion')}</span>
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="relative flex size-full flex-col" data-testid="sketch-stage" data-dirty={dirty || undefined}>
      {headerSlot ? createPortal(headerActions, headerSlot) : null}
      {sketch.underlay ? (
        <div className="shrink-0 border-b px-3 py-2">
          <UnderlayBanner
            underlay={sketch.underlay}
            shown={underlayShown}
            documentId={sketch.documentId}
            baseVersionId={sketch.versionId}
            canMove={canWrite && saveTarget === 'published' && !dirty}
            onMoved={onReopen}
            projectId={sketch.projectId ?? null}
            dirty={dirty}
          />
        </div>
      ) : null}
      {confirmingDiscard ? (
        <div className="bg-muted/60 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm" role="alert" data-testid="sketch-discard">
          <span className="mr-auto">
            {confirmingDiscard.others.length > 0
              ? t('sketch.discardShared', { names: confirmingDiscard.others.join(', ') })
              : t('sketch.discardQuestion')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDiscard(false)}>
            {t('sketch.keepEditing')}
          </Button>
          <Button variant="destructive" size="sm" onClick={close} data-testid="sketch-discard-confirm">
            {t('sketch.discard')}
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0" data-stage-keys>
          <SketchCanvas
            initialElements={[]}
            initialScene={sketch.scene}
            theme={theme}
            langCode={locale === 'de' ? 'de-DE' : 'en'}
            onReady={onReady}
            onDirtyChange={onDirtyChange}
            onUnderlay={onUnderlay}
            collab={room.collab}
            onApi={setApi}
            autoFocus
          />
        </div>
        <SketchPins
          api={api}
          review={review}
          canAnnotate={canWrite && review.canAnnotate}
          onAnnotate={annotate}
          canPickAssignee={canPickAssignee}
          cards={!cardsDocked}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center" aria-live="polite">
          <StatusNote state={revised.state} room={room} viewOnly={!canWrite} />
        </div>
      </div>
    </div>
  )
}

/** The save's and the room's word, when there is one; a reader is told the canvas only shows. */
function StatusNote({ state, room, viewOnly }: { state: SketchRevisionState; room: SketchRoom; viewOnly: boolean }) {
  const t = useTranslations(diagramsCopy)
  const said = state.kind !== 'idle' && state.kind !== 'saving'
  const roomSays = room.peerSave !== null || room.tooLarge.length > 0 || room.refused.length > 0
  if (!said && !roomSays && !viewOnly) return null
  return (
    <FloatingNote data-testid="sketch-status" className="max-w-xl text-center whitespace-normal">
      {viewOnly && !said && !roomSays ? t('sketch.viewOnly') : null}
      {said ? <RevisionStatus state={state} /> : null}
      {roomSays ? <RoomStatus room={room} /> : null}
    </FloatingNote>
  )
}
