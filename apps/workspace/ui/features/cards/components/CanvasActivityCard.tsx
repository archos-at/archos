'use client'

import { useCallback, useMemo, useState, type JSX } from 'react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { Check, MapPin, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { COMMENT_PIN_ON_POINT, CommentPin } from '@/components/ui/comment-pin'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { useInView } from '@/hooks/use-in-view'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatDayRange } from '@/lib/format'
import { isOptimizerEligible } from '@/lib/images/optimizable'
import { AnnotationRequestError, updateAnnotation } from '@/lib/annotations/client'
import { ChangeRequestError, undoChange } from '@/lib/changes/client'
import type { AgentChangeView } from '@/lib/changes/types'
import { PRODUCT_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/store'
import { openReviewAt } from '@/features/documents/lib/open-review'
import { isCardDecision, itemDecisionKey, type CardDecision } from '../card-decision'
import { selectCardConversationId, selectCardDecision } from '../hooks/use-card-decision'
import { useFirstPageThumbnail, useLiveMarks, type LiveMarks } from '../hooks/use-canvas-document'
import { useTurnChanges, type TurnChanges } from '../hooks/use-turn-changes'
import {
  activityCounts,
  annotationIdOf,
  createdState,
  firstWords,
  isProposed,
  isSet,
  markState,
  placeStyle,
  stillAsLeft,
  undoRequest,
  type CanvasActivityDocument,
  type CanvasActivityItem,
  type CanvasChangedItem,
  type CanvasDeletedItem,
  type CanvasFieldChange,
  type CanvasRepliedItem,
  type CanvasSetItem,
  type LiveMark,
  type MarkState,
} from '../lib/canvas-activity'
import { matchChanges, standsAsChanged } from '../lib/canvas-changes'
import { ClampedText } from './ClampedText'
import { ProposalShell } from './ProposalShell'
import { StackedLabel } from '@/components/ui/stacked-label'
import { isAgentKind } from '@/lib/agent-kind'

const DEFAULT_PAGE_ASPECT = Math.SQRT2

export interface CanvasActivityCardProps {
  document: CanvasActivityDocument
  items: readonly CanvasActivityItem[]
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
}

type AnswerOutcome = 'done' | 'moved' | 'gone' | 'forbidden' | 'failed'

async function answerMark(
  documentId: string,
  annotationId: string,
  status: 'open' | 'dismissed',
  live: LiveMarks
): Promise<AnswerOutcome> {
  try {
    live.adopt(await updateAnnotation(documentId, annotationId, { status, expectedStatus: 'proposed' }))
    return 'done'
  } catch (failure) {
    if (!(failure instanceof AnnotationRequestError)) return 'failed'
    if (failure.status === 409) return 'moved'
    if (failure.status === 403) return 'forbidden'
    if (failure.status === 404) {
      live.forget(annotationId)
      return 'gone'
    }
    return 'failed'
  }
}

const decidedBy = (mark: LiveMark | 'gone' | undefined): string | null => {
  if (!mark || mark === 'gone') return null
  return mark.status === 'open' ? mark.acceptedByName : mark.closedByName
}

const storedDecision = (value: string | undefined): CardDecision | null => (isCardDecision(value) ? value : null)

type ShowInDocument = (annotationId: string) => void

export function CanvasActivityCard({
  document,
  items,
  messageId,
  cardKey,
  decisionsMustPersist,
}: CanvasActivityCardProps): JSX.Element {
  const t = useTranslations(chatCopy)
  const [seenRef, seen] = useSeenOnce<HTMLDivElement>()
  const [viewRef, onScreen] = useInView<HTMLDivElement>()
  const cardRef = useCallback(
    (node: HTMLDivElement | null) => {
      seenRef(node)
      viewRef(node)
    },
    [seenRef, viewRef]
  )
  const counts = activityCounts(items)
  const setCount = counts.proposed + counts.created
  const hasMarks = setCount + counts.changed > 0
  const markIds = useMemo(() => items.map(annotationIdOf).filter((id): id is string => id !== null), [items])
  const live = useLiveMarks(document.id, { seen: seen && hasMarks, onScreen: onScreen && hasMarks, watch: markIds })
  const conversationId = useChatStore((state) => selectCardConversationId(state, messageId))
  const changes = useTurnChanges(conversationId, messageId, { enabled: seen, token: live.touched })
  const changeOf = useMemo(() => matchChanges(items, changes.changes), [items, changes.changes])
  const thumbnail = useFirstPageThumbnail(document.id, seen && setCount > 0)
  const [aspect, setAspect] = useState(DEFAULT_PAGE_ASPECT)
  const show = useShowInDocument(document.id)
  const [showError, setShowError] = useState(false)
  const proposedItems = items.filter(isProposed)
  const storedAnswers = useChatStore((state) =>
    proposedItems
      .map((item) => selectCardDecision(state, messageId, itemDecisionKey(cardKey, item.annotation_id)) ?? '')
      .join('|')
  ).split('|')

  const openAt: ShowInDocument = (annotationId) => {
    setShowError(false)
    void show(annotationId).then((ok) => setShowError(!ok))
  }

  const proposedStates = proposedItems.map((item, index) =>
    markState(storedDecision(storedAnswers[index]), live.lookup(item.annotation_id))
  )
  const tone =
    proposedStates.some((state) => state === 'proposed')
      ? 'pending'
      : proposedStates.length === items.length && proposedStates.every((state) => state === 'dismissed' || state === 'gone')
        ? 'dismissed'
        : 'accepted'

  const firstId = items.map(annotationIdOf).find((id) => id !== null) ?? null

  const mayAct = !decisionsMustPersist || Boolean(messageId)

  const pendingIds = proposedItems
    .filter((item, index) => {
      const current = live.lookup(item.annotation_id)
      return (
        current !== undefined &&
        current !== 'gone' &&
        current.canEdit &&
        markState(storedDecision(storedAnswers[index]), current) === 'proposed'
      )
    })
    .map((item) => item.annotation_id)
  const [batch, setBatch] = useState<'open' | 'dismissed' | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<{ open: boolean; count: number }>({ open: false, count: 0 })
  const [batchError, setBatchError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<ReadonlyMap<string, string | null>>(new Map())
  const showBatch = mayAct && (pendingIds.length >= 2 || batch !== null)

  const runBatch = async (status: 'open' | 'dismissed') => {
    if (batch) return
    setBatch(status)
    setBatchError(null)
    setSkipped(new Map())
    const moved: string[] = []
    let failed = 0
    try {
      for (const id of pendingIds) {
        const outcome = await answerMark(document.id, id, status, live)
        if (outcome === 'moved') moved.push(id)
        else if (outcome === 'forbidden' || outcome === 'failed') failed += 1
      }
      if (moved.length > 0) {
        const lookup = await live.refresh()
        setSkipped(new Map(moved.map((id) => [id, lookup ? decidedBy(lookup(id)) : null])))
      }
      if (failed > 0) setBatchError(t('cards.canvasActivity.batch.failed', { count: failed }))
    } finally {
      setBatch(null)
    }
  }

  return (
    <ProposalShell tone={tone}>
      <div ref={cardRef} className="flex flex-col gap-3" data-testid="canvas-activity-card">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AgentGlyph size="xs" />
          {live.connected && (
            <span
              aria-hidden
              data-testid="canvas-activity-live"
              className="bg-foreground/60 animate-caret-breathe size-1.5 shrink-0 rounded-full motion-reduce:animate-none"
            />
          )}
          <p className="card-title text-foreground min-w-0">
            {headline(t, counts)}
            <span className="text-muted-foreground font-normal">
              {' · '}
              <span className="break-all">{document.name}</span>
            </span>
          </p>
          {firstId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => openAt(firstId)}
              data-testid="canvas-activity-show"
            >
              <MapPin aria-hidden className="size-3.5" />
              {t('cards.canvasActivity.show')}
            </Button>
          )}
        </div>

        {showBatch && (
          <div className="flex flex-wrap items-center gap-2" data-testid="canvas-activity-batch">
            <Button
              type="button"
              size="sm"
              onClick={() => void runBatch('open')}
              aria-disabled={batch !== null || undefined}
              aria-busy={batch === 'open' || undefined}
              className="aria-disabled:cursor-default"
            >
              <StackedLabel
                busy={batch === 'open'}
                idle={t('cards.canvasActivity.batch.acceptAll')}
                working={t('cards.canvasActivity.batch.accepting')}
              />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => batch === null && setConfirmDiscard({ open: true, count: pendingIds.length })}
              aria-disabled={batch !== null || undefined}
              aria-busy={batch === 'dismissed' || undefined}
              className="aria-disabled:cursor-default aria-disabled:opacity-50"
            >
              <StackedLabel
                busy={batch === 'dismissed'}
                idle={t('cards.canvasActivity.batch.rejectRest')}
                working={t('cards.canvasActivity.batch.rejecting')}
              />
            </Button>
          </div>
        )}
        {batchError && (
          <p className="card-caption text-destructive" role="alert">
            {batchError}
          </p>
        )}
        <ConfirmDialog
          open={confirmDiscard.open}
          onOpenChange={(open) => setConfirmDiscard((previous) => ({ ...previous, open }))}
          title={t('cards.canvasActivity.batch.confirmTitle', { count: confirmDiscard.count })}
          description={t('cards.canvasActivity.batch.confirmBody')}
          confirmLabel={t('cards.canvasActivity.batch.confirm')}
          cancelLabel={t('cards.canvasActivity.batch.cancel')}
          onConfirm={() => runBatch('dismissed')}
        />

        <ul className="flex flex-col gap-3">
          {items.map((item, index) => {
            if (isSet(item)) {
              return (
                <SetRow
                  key={`${item.action}-${item.annotation_id}`}
                  documentId={document.id}
                  item={item}
                  live={live}
                  change={changeOf.get(index)}
                  changes={changes}
                  messageId={messageId}
                  cardKey={cardKey}
                  mayAct={mayAct}
                  skippedBy={skipped.get(item.annotation_id)}
                  thumbnail={item.page === 1 ? thumbnail : null}
                  aspect={aspect}
                  onAspect={setAspect}
                  onShow={openAt}
                />
              )
            }
            if (item.action === 'changed') {
              return (
                <ChangedRow
                  key={`c-${item.annotation_id}-${index}`}
                  documentId={document.id}
                  item={item}
                  index={index}
                  live={live}
                  change={changeOf.get(index)}
                  changes={changes}
                  messageId={messageId}
                  cardKey={cardKey}
                  mayAct={mayAct}
                  onShow={openAt}
                />
              )
            }
            if (item.action === 'deleted') {
              return (
                <DeletedRow
                  key={`d-${item.number}-${index}`}
                  item={item}
                  live={live}
                  change={changeOf.get(index)}
                  changes={changes}
                />
              )
            }
            return (
              <RepliedRow
                key={`r-${item.annotation_id}-${item.number}`}
                item={item}
                live={live}
                change={changeOf.get(index)}
                changes={changes}
                onShow={openAt}
              />
            )
          })}
        </ul>

        {showError && (
          <p className="card-caption text-destructive" role="alert">
            {t('cards.canvasActivity.showError')}
          </p>
        )}
      </div>
    </ProposalShell>
  )
}

type Translate = ReturnType<typeof useTranslations>

function headline(t: Translate, counts: ReturnType<typeof activityCounts>): string {
  const acts = (['created', 'proposed', 'changed', 'deleted'] as const)
    .filter((act) => counts[act] > 0)
    .map((act) => t(`cards.canvasActivity.headline.${act}`, { count: counts[act] }))
  if (acts.length > 0) {
    if (counts.replied > 0) acts.push(t('cards.canvasActivity.headline.repliedPart', { threads: counts.replied }))
    return acts.join(', ')
  }
  if (counts.repliedNumber !== null) {
    return t('cards.canvasActivity.headline.repliedOne', { number: counts.repliedNumber })
  }
  return t('cards.canvasActivity.headline.repliedMany', { count: counts.replied })
}

function useShowInDocument(documentId: string): (annotationId: string) => Promise<boolean> {
  const router = useRouter()
  const pathname = usePathname()
  const projectId = useChatStore((s) => s.projectId)
  return async (annotationId) => {
    if (!projectId) return false
    const result = await openReviewAt(
      { documentId, annotationId },
      {
        projectId,
        location: pathname ? { pathname, search: window.location.search, hash: window.location.hash } : undefined,
        navigate: (href, how) => (how === 'push' ? router.push(href) : router.replace(href, { scroll: false })),
      }
    )
    return result !== 'unavailable'
  }
}

function useServerUndo(change: AgentChangeView | undefined, live: LiveMarks, changes: TurnChanges) {
  const t = useTranslations(chatCopy)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const undo = async () => {
    if (!change || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const done = await undoChange(change.id)
      changes.adopt(done.change)
      await live.refresh()
    } catch (failure) {
      if (failure instanceof ChangeRequestError && failure.status === 409 && failure.code === 'already-undone') {
        const fresh = await changes.refetch()
        if (!fresh?.some((row) => row.id === change.id && row.undoneAt !== null)) {
          setNotice(t('cards.canvasActivity.alreadyUndone'))
        }
      } else if (failure instanceof ChangeRequestError && failure.status === 409) {
        setNotice(t('cards.canvasActivity.movedOn'))
        await Promise.all([changes.refetch(), live.refresh()])
      } else if (failure instanceof ChangeRequestError && failure.status === 403) {
        setError(t('cards.canvasActivity.forbidden'))
      } else {
        setError(t('cards.canvasActivity.error'))
      }
    } finally {
      setBusy(false)
    }
  }

  return { undo, busy, notice, error }
}

function ForPerson({ change }: { change: AgentChangeView | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (!change?.onBehalfOfName) return null
  return (
    <>
      <span aria-hidden>·</span>
      <span data-testid="canvas-activity-for">{t('cards.canvasActivity.forPerson', { name: change.onBehalfOfName })}</span>
    </>
  )
}

function UndoneLabel({ who }: { who: string | null }): JSX.Element {
  const t = useTranslations(chatCopy)
  return (
    <span className="text-muted-foreground ml-auto inline-flex items-center gap-1" data-testid="canvas-activity-state">
      <Undo2 aria-hidden className="size-3" />
      {t('cards.canvasActivity.undone')}
      {who && <span>· {who}</span>}
    </span>
  )
}

function UndoButton({ number, busy, onClick }: { number: number; busy: boolean; onClick: () => void }): JSX.Element {
  const t = useTranslations(chatCopy)
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      aria-label={t('cards.canvasActivity.undoLabel', { number })}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className="aria-disabled:cursor-default"
    >
      <StackedLabel busy={busy} idle={t('cards.canvasActivity.undo')} working={t('cards.canvasActivity.undoing')} />
    </Button>
  )
}

function UndoMessages({ notice, error }: { notice: string | null; error: string | null }): JSX.Element {
  return (
    <>
      {notice && (
        <p className="card-caption text-muted-foreground" role="status" data-testid="canvas-activity-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="card-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

function PageSilhouette({
  item,
  state,
  thumbnail,
  aspect,
  onAspect,
}: {
  item: CanvasSetItem
  state: MarkState
  thumbnail: string | null
  aspect: number
  onAspect: (aspect: number) => void
}): JSX.Element {
  const proposed = state === 'proposed'
  const done = state === 'resolved' || state === 'dismissed' || state === 'gone'
  const place = placeStyle(item)
  return (
    <span aria-hidden className="relative block w-20 shrink-0 self-start" style={{ aspectRatio: String(aspect) }}>
      <span className="border-border bg-background absolute inset-0 overflow-hidden rounded-[2px] border">
        {thumbnail && (
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes="80px"
            unoptimized={!isOptimizerEligible(thumbnail)}
            className="object-fill opacity-80"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget
              if (naturalWidth > 0 && naturalHeight > 0) onAspect(naturalWidth / naturalHeight)
            }}
          />
        )}
        {place.width && (
          <span
            data-testid="canvas-activity-region"
            className={cn(
              'border-foreground absolute rounded-[1px] border-[1.5px]',
              proposed && 'border-dashed',
              done && 'opacity-40'
            )}
            style={place}
          />
        )}
      </span>
      <span className={cn('absolute z-10', COMMENT_PIN_ON_POINT)} style={{ left: place.left, top: place.top }}>
        <CommentPin
          as="span"
          number={item.number}
          proposed={proposed}
          done={done}
          className="origin-bottom-left scale-75"
        />
      </span>
    </span>
  )
}

function SetRow({
  documentId,
  item,
  live,
  change,
  changes,
  messageId,
  cardKey,
  mayAct,
  skippedBy,
  thumbnail,
  aspect,
  onAspect,
  onShow,
}: {
  documentId: string
  item: CanvasSetItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  messageId?: string
  cardKey: string
  mayAct: boolean
  skippedBy?: string | null
  thumbnail: string | null
  aspect: number
  onAspect: (aspect: number) => void
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const decision = useChatStore((state) =>
    selectCardDecision(state, messageId, itemDecisionKey(cardKey, item.annotation_id))
  )
  const [busy, setBusy] = useState<'open' | 'dismissed' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const serverUndo = useServerUndo(change, live, changes)
  const current = live.lookup(item.annotation_id)
  const proposal = isProposed(item)
  const undone = change?.undoneAt != null
  const state = undone ? 'gone' : proposal ? markState(decision, current) : createdState(current)
  const mayAnswer = state === 'proposed' && mayAct && (current === undefined || current === 'gone' || current.canEdit)
  const mayUndo = !proposal && change?.canUndo === true && !undone
  const showState = proposal ? state !== 'proposed' : state !== 'open'

  const answer = async (status: 'open' | 'dismissed') => {
    if (busy) return
    setBusy(status)
    setError(null)
    try {
      const outcome = await answerMark(documentId, item.annotation_id, status, live)
      if (outcome === 'moved') await live.refresh()
      else if (outcome === 'forbidden') setError(t('cards.canvasActivity.forbidden'))
      else if (outcome === 'failed') setError(t('cards.canvasActivity.error'))
    } finally {
      setBusy(null)
    }
  }

  const kind = t(`cards.canvasActivity.kinds.${item.kind}`)
  const who = current && current !== 'gone' ? (state === 'open' ? current.acceptedByName : current.closedByName) : null

  return (
    <li className="flex gap-3" data-testid={`canvas-activity-${item.action}`} data-state={state}>
      <PageSilhouette item={item} state={state} thumbnail={thumbnail} aspect={aspect} onAspect={onAspect} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span className="text-foreground font-mono">#{item.number}</span>
          <span aria-hidden>·</span>
          <span>{kind}</span>
          <span aria-hidden>·</span>
          <span>{t('cards.canvasActivity.page', { page: item.page })}</span>
          <ForPerson change={change} />
          <SkippedNote by={skippedBy} />
          {undone ? (
            <UndoneLabel who={change?.undoneByName ?? null} />
          ) : (
            showState && <MarkStateLabel state={state} who={decision ? null : who} />
          )}
        </p>
        <ClampedText className="card-body text-foreground">{item.body}</ClampedText>
        <ThreadGlance mark={current} />
        {error && (
          <p className="card-caption text-destructive" role="alert">
            {error}
          </p>
        )}
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {mayAnswer && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => void answer('open')}
                aria-label={t('cards.canvasActivity.acceptLabel', { number: item.number })}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === 'open' || undefined}
                className="aria-disabled:cursor-default"
              >
                <StackedLabel
                  busy={busy === 'open'}
                  idle={t('cards.canvasActivity.accept')}
                  working={t('cards.canvasActivity.accepting')}
                />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void answer('dismissed')}
                aria-label={t('cards.canvasActivity.rejectLabel', { number: item.number })}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === 'dismissed' || undefined}
                className="aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                {t('cards.canvasActivity.reject')}
              </Button>
            </>
          )}
          {mayUndo && <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />}
          {state !== 'gone' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onShow(item.annotation_id)}
              aria-label={t('cards.canvasActivity.showMarkLabel', { number: item.number })}
            >
              {t('cards.canvasActivity.show')}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

function ThreadGlance({ mark }: { mark: LiveMark | 'gone' | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (!mark || mark === 'gone' || mark.replyCount === 0) return null
  const last = mark.lastReply
  const name = last
    ? isAgentKind(last.authorKind)
      ? PRODUCT_NAME
      : (last.authorName ?? t('cards.canvasActivity.thread.someone'))
    : null
  return (
    <p className="card-caption text-muted-foreground" data-testid="canvas-activity-thread">
      {t('cards.canvasActivity.thread.count', { count: mark.replyCount })}
      {last && name && ` · ${t('cards.canvasActivity.thread.last', { name, excerpt: firstWords(last.body) })}`}
    </p>
  )
}

function SkippedNote({ by }: { by: string | null | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (by === undefined) return null
  return (
    <>
      <span aria-hidden>·</span>
      <span data-testid="canvas-activity-skipped">
        {by ? t('cards.canvasActivity.batch.alreadyBy', { name: by }) : t('cards.canvasActivity.batch.already')}
      </span>
    </>
  )
}

function MarkStateLabel({ state, who }: { state: MarkState; who: string | null }): JSX.Element {
  const t = useTranslations(chatCopy)
  const kept = state === 'open' || state === 'resolved'
  const Icon = kept ? Check : X
  return (
    <span
      className={cn('ml-auto inline-flex items-center gap-1', kept ? 'text-success' : 'text-muted-foreground')}
      data-testid="canvas-activity-state"
    >
      <Icon aria-hidden className="size-3" />
      {t(`cards.canvasActivity.state.${state}`)}
      {who && <span className="text-muted-foreground">· {who}</span>}
    </span>
  )
}

function changePhrase(t: Translate, locale: string, change: CanvasFieldChange): string {
  const after = change.after ?? null
  switch (change.field) {
    case 'status':
      if (after === 'open') {
        return t(change.before === 'proposed' ? 'cards.canvasActivity.change.taken' : 'cards.canvasActivity.change.reopened')
      }
      return t(after === 'dismissed' ? 'cards.canvasActivity.change.dismissed' : 'cards.canvasActivity.change.resolved')
    case 'assignee':
      if (!after) return t('cards.canvasActivity.change.unassigned')
      return t('cards.canvasActivity.change.assigned', {
        name: change.after_label ?? t('cards.canvasActivity.change.someone'),
      })
    case 'due_on':
      return after
        ? t('cards.canvasActivity.change.due', { date: formatDayRange(after, after, locale) })
        : t('cards.canvasActivity.change.undue')
    case 'kind':
      return t('cards.canvasActivity.change.kind', {
        kind: after === 'hint' || after === 'question' || after === 'defect' ? t(`cards.canvasActivity.kinds.${after}`) : '',
      })
    default:
      return t('cards.canvasActivity.change.body')
  }
}

function ChangedRow({
  documentId,
  item,
  index,
  live,
  change,
  changes,
  messageId,
  cardKey,
  mayAct,
  onShow,
}: {
  documentId: string
  item: CanvasChangedItem
  index: number
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  messageId?: string
  cardKey: string
  mayAct: boolean
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const stored = useChatStore((state) =>
    selectCardDecision(state, messageId, itemDecisionKey(cardKey, `${item.annotation_id}@${index}`))
  )
  const [replayed, setReplayed] = useState(false)
  const [replayBusy, setReplayBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverUndo = useServerUndo(change, live, changes)
  const current = live.lookup(item.annotation_id)
  const inverse = undoRequest(item)
  const undone = change ? change.undoneAt !== null : stored === 'rejected' || replayed
  const moved =
    !undone &&
    current !== undefined &&
    current !== 'gone' &&
    (change ? !change.canUndo && !standsAsChanged(change, current) : !stillAsLeft(item, current))
  const mayUndo = change
    ? change.canUndo && !undone && current !== 'gone'
    : inverse !== null && mayAct && !undone && !moved && current !== 'gone' && (current === undefined || current.canEdit)
  const busy = change ? serverUndo.busy : replayBusy

  const replayUndo = async () => {
    if (replayBusy || inverse === null) return
    setReplayBusy(true)
    setError(null)
    try {
      const now = (await live.refresh())?.(item.annotation_id)
      if (now === 'gone' || (now && !stillAsLeft(item, now))) return
      const updated = await updateAnnotation(documentId, item.annotation_id, inverse)
      live.adopt(updated)
      setReplayed(true)
    } catch (failure) {
      if (failure instanceof AnnotationRequestError && failure.status === 409) {
        await live.refresh()
      } else if (failure instanceof AnnotationRequestError && failure.status === 404) {
        live.forget(item.annotation_id)
      } else if (failure instanceof AnnotationRequestError && failure.status === 403) {
        setError(t('cards.canvasActivity.forbidden'))
      } else {
        setError(t('cards.canvasActivity.error'))
      }
    } finally {
      setReplayBusy(false)
    }
  }

  const phrases = item.changes.map((entry) => changePhrase(t, locale, entry)).join(' · ')
  const state: MarkState | null = current === 'gone' ? 'gone' : moved && current ? current.status : null

  return (
    <li className="flex gap-3" data-testid="canvas-activity-changed" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} done={undone || current === 'gone'} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span className="text-foreground font-mono">#{item.number}</span>
          <span className="text-foreground">{phrases}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
          {!undone && state && (
            <span className="text-muted-foreground ml-auto" data-testid="canvas-activity-state">
              {state === 'gone'
                ? t('cards.canvasActivity.state.gone')
                : t('cards.canvasActivity.movedSince', { state: t(`cards.canvasActivity.status.${state}`) })}
            </span>
          )}
        </p>
        <ClampedText className="card-body text-foreground">{`„${item.note}“`}</ClampedText>
        <ThreadGlance mark={current} />
        {error && (
          <p className="card-caption text-destructive" role="alert">
            {error}
          </p>
        )}
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {mayUndo && (
            <UndoButton
              number={item.number}
              busy={busy}
              onClick={() => void (change ? serverUndo.undo() : replayUndo())}
            />
          )}
          {current !== 'gone' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onShow(item.annotation_id)}
              aria-label={t('cards.canvasActivity.showMarkLabel', { number: item.number })}
            >
              {t('cards.canvasActivity.show')}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

function DeletedRow({
  item,
  live,
  change,
  changes,
}: {
  item: CanvasDeletedItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const serverUndo = useServerUndo(change, live, changes)
  const undone = change?.undoneAt != null
  return (
    <li className="flex gap-3" data-testid="canvas-activity-deleted" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} done={!undone} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span>{t('cards.canvasActivity.deleted', { number: item.number })}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
        </p>
        <ClampedText className={cn('card-body', undone ? 'text-foreground' : 'text-muted-foreground line-through')}>
          {item.body}
        </ClampedText>
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        {change?.canUndo && !undone && (
          <div className="pt-1">
            <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />
          </div>
        )}
      </div>
    </li>
  )
}

function RepliedRow({
  item,
  live,
  change,
  changes,
  onShow,
}: {
  item: CanvasRepliedItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const serverUndo = useServerUndo(change, live, changes)
  const undone = change?.undoneAt != null
  return (
    <li className="flex gap-3" data-testid="canvas-activity-replied" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span>{t('cards.canvasActivity.repliedIn', { number: item.number })}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
        </p>
        <ClampedText className={cn('card-body', undone ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {`„${item.excerpt}“`}
        </ClampedText>
        <ThreadGlance mark={live.lookup(item.annotation_id)} />
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {change?.canUndo && !undone && (
            <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onShow(item.annotation_id)}
            aria-label={t('cards.canvasActivity.showThreadLabel', { number: item.number })}
          >
            {t('cards.canvasActivity.show')}
          </Button>
        </div>
      </div>
    </li>
  )
}
