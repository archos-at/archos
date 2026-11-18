'use client'

import { useCallback, useMemo, useState, type JSX } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StackedLabel } from '@/components/ui/stacked-label'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { useInView } from '@/hooks/use-in-view'
import { useSeenOnce } from '@/hooks/use-seen-once'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useChatStore } from '@/features/chat/store'
import { isCardDecision, itemDecisionKey, type CardDecision } from '../card-decision'
import { selectCardConversationId, selectCardDecision } from '../hooks/use-card-decision'
import { useFirstPageThumbnail, useLiveMarks } from '../hooks/use-canvas-document'
import { useShowInDocument, type ShowInDocument } from '../hooks/use-show-in-document'
import { useTurnChanges } from '../hooks/use-turn-changes'
import {
  activityCounts,
  annotationIdOf,
  isProposed,
  isSet,
  markState,
  type CanvasActivityDocument,
  type CanvasActivityItem,
  type LiveMark,
} from '../lib/canvas-activity'
import { headline } from '../lib/canvas-activity-phrases'
import { matchChanges } from '../lib/canvas-changes'
import { ProposalShell } from './ProposalShell'
import { answerMark } from './canvas-activity-card/answer-mark'
import { ChangedRow } from './canvas-activity-card/changed-row'
import { DeletedRow } from './canvas-activity-card/deleted-row'
import { RepliedRow } from './canvas-activity-card/replied-row'
import { SetRow } from './canvas-activity-card/set-row'

const DEFAULT_PAGE_ASPECT = Math.SQRT2

export interface CanvasActivityCardProps {
  document: CanvasActivityDocument
  items: readonly CanvasActivityItem[]
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
}

const decidedBy = (mark: LiveMark | 'gone' | undefined): string | null => {
  if (!mark || mark === 'gone') return null
  return mark.status === 'open' ? mark.acceptedByName : mark.closedByName
}

const storedDecision = (value: string | undefined): CardDecision | null => (isCardDecision(value) ? value : null)

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
