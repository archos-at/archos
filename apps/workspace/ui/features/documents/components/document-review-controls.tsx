'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { hasLiveMarks, openMarksLabel } from './open-marks-chip'
import { formatAbsoluteTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import {
  DELEGATE_REVISION,
  availableLifecycleGestures,
  lifecycleRequestFor,
  reviewOpRequiresComment,
  type DocumentLifecycleGesture,
  type DocumentLifecycleViewer,
} from '../lib/document-lifecycle'

const ACTION_LABEL: Record<DocumentLifecycleGesture, string> = {
  submit: 'lifecycle.actions.submit',
  approve: 'lifecycle.actions.approve',
  request_changes: 'lifecycle.actions.requestChanges',
  [DELEGATE_REVISION]: 'lifecycle.actions.delegateRevision',
  reject: 'lifecycle.actions.reject',
  publish: 'lifecycle.actions.publish',
  archive: 'lifecycle.actions.archive',
}

const PRIMARY_ACTION: Partial<Record<DocumentLifecycleGesture, true>> = {
  approve: true,
}

const OVERFLOW_ACTION: Partial<Record<DocumentLifecycleGesture, true>> = {
  [DELEGATE_REVISION]: true,
  reject: true,
}

export interface ReviewerOption {
  userId: string
  name: string
}

export interface DocumentReviewControlsProps {
  version: Pick<
    DocumentVersionView,
    'id' | 'state' | 'submittedBy' | 'versionNumber' | 'updatedAt'
  > | null
  lifecycle: 'active' | 'archived'
  viewer: DocumentLifecycleViewer
  pending?: DocumentLifecycleGesture | null
  onAct: (
    gesture: DocumentLifecycleGesture,
    options?: {
      comment?: string
      reviewerUserIds?: readonly string[]
      orderMessage?: string
      dueAt?: string
    },
  ) => void
  reviewers?: readonly ReviewerOption[]
  actingName?: string | null
  revisionNumber?: number
  publishBare?: boolean
  openMarks?: OpenMarksAtApproval | null
  className?: string
}

export type OpenMarksAtApproval =
  | { status: 'counted'; open: number; proposed: number; onOpen: () => void }
  | { status: 'loading' }
  | { status: 'unavailable'; onOpen: () => void }

export function DocumentReviewControls({
  version,
  lifecycle,
  viewer,
  pending = null,
  onAct,
  reviewers = [],
  actingName = null,
  revisionNumber,
  publishBare = false,
  openMarks = null,
  className,
}: DocumentReviewControlsProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [typing, setTyping] = useState<DocumentLifecycleGesture | null>(null)
  const [comment, setComment] = useState('')
  const [reviewer, setReviewer] = useState<string>('')
  const [order, setOrder] = useState('')
  const [due, setDue] = useState('')
  const [approving, setApproving] = useState(false)
  const [approvedChecked, setApprovedChecked] = useState(false)

  useEffect(() => {
    setReviewer('')
    setOrder('')
    setDue('')
    setTyping(null)
    setComment('')
    setApproving(false)
    setApprovedChecked(false)
  }, [version?.id])

  const gestures = availableLifecycleGestures(version, lifecycle, viewer).filter(
    (gesture) => gesture !== 'archive',
  )

  if (gestures.length === 0) return null

  const start = (gesture: DocumentLifecycleGesture) => {
    if (gesture === 'approve') {
      setTyping(null)
      setComment('')
      setApprovedChecked(false)
      setApproving(true)
      return
    }
    setApproving(false)
    setApprovedChecked(false)
    const { action } = lifecycleRequestFor(gesture)
    if (action !== 'archive' && reviewOpRequiresComment(action)) {
      setComment('')
      setTyping(gesture)
      return
    }
    onAct(gesture)
  }

  const send = () => {
    if (!typing || comment.trim() === '') return
    onAct(typing, { comment: comment.trim() })
    setTyping(null)
    setComment('')
  }

  const confirmApprove = () => {
    if (!approvedChecked) return
    onAct('approve')
    setApproving(false)
    setApprovedChecked(false)
  }

  const offersSubmit = gestures.includes('submit')
  const offersPublish = gestures.includes('publish')
  const rowGestures = gestures.filter((gesture) => gesture !== 'submit' && gesture !== 'publish')
  const visibleGestures = rowGestures.filter((gesture) => !OVERFLOW_ACTION[gesture])
  const overflow: ActionMenuEntry[] = rowGestures
    .filter((gesture) => OVERFLOW_ACTION[gesture])
    .map((gesture) => ({
      type: 'item',
      id: gesture,
      label: t(ACTION_LABEL[gesture]),
      variant: gesture === 'reject' ? 'destructive' : 'default',
      disabled: pending !== null,
      onSelect: () => start(gesture),
      testId: `document-lifecycle-${gesture}`,
    }))
  const primary = visibleGestures.filter((gesture) => PRIMARY_ACTION[gesture])
  const secondary = visibleGestures.filter((gesture) => !PRIMARY_ACTION[gesture])
  const shownNumber = revisionNumber ?? version?.versionNumber ?? 0
  const decisionButton = (gesture: DocumentLifecycleGesture) => (
    <Button
      key={gesture}
      type="button"
      size="sm"
      variant={PRIMARY_ACTION[gesture] ? 'default' : 'secondary'}
      className="h-8 flex-1"
      disabled={pending !== null}
      aria-busy={pending === gesture}
      data-testid={`document-lifecycle-${gesture}`}
      onClick={() => start(gesture)}
    >
      {t(ACTION_LABEL[gesture])}
    </Button>
  )

  const needsReviewerChoice = offersSubmit && reviewers.length > 0
  const reviewerSet = !needsReviewerChoice || reviewer !== ''
  const orderSet = order.trim() !== ''
  const submitReady = reviewerSet && orderSet

  const submitNow = () => {
    if (!submitReady || pending !== null) return
    const orderMessage = order.trim()
    const dueAt = due.trim() !== '' ? due.trim() : undefined
    if (reviewer === '') {
      onAct('submit', dueAt === undefined ? { orderMessage } : { orderMessage, dueAt })
      return
    }
    onAct(
      'submit',
      dueAt === undefined
        ? { reviewerUserIds: [reviewer], orderMessage }
        : { reviewerUserIds: [reviewer], orderMessage, dueAt },
    )
  }

  const today = formatAbsoluteTime(new Date().toISOString(), locale)

  return (
    <div className={cn('space-y-2', className)} data-testid="document-review-controls">
      {offersSubmit && (
        <div className="space-y-2 rounded-surface border p-2.5" data-testid="document-review-submit">
          {needsReviewerChoice ? (
            <div className="space-y-1">
              <label
                htmlFor="document-review-reviewer-input"
                className="text-muted-foreground block text-xs"
              >
                {t('lifecycle.submit.reviewerLabel')}
              </label>
              <Select value={reviewer} onValueChange={setReviewer}>
                <SelectTrigger
                  id="document-review-reviewer-input"
                  className="h-8 w-full"
                  data-testid="document-review-reviewer"
                >
                  <SelectValue placeholder={t('lifecycle.submit.reviewerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {reviewers.map((person) => (
                    <SelectItem key={person.userId} value={person.userId}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p
              className="text-muted-foreground text-xs"
              data-testid="document-review-submit-note"
            >
              {t('lifecycle.submit.selfReviewNote')}
            </p>
          )}
          <div className="space-y-1">
            <label
              htmlFor="document-review-order-input"
              className="text-muted-foreground block text-xs"
            >
              {t('lifecycle.submit.orderLabel')}
            </label>
            <Input
              id="document-review-order-input"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              placeholder={t('lifecycle.submit.orderPlaceholder')}
              className="h-8"
              data-testid="document-review-order"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="document-review-due-input"
              className="text-muted-foreground block text-xs"
            >
              {t('lifecycle.submit.dueLabel')}
            </label>
            <Input
              id="document-review-due-input"
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="h-8"
              data-testid="document-review-due"
            />
          </div>
          {!submitReady && (
            <ul
              className="text-muted-foreground space-y-0.5 text-xs"
              data-testid="document-review-submit-hint"
            >
              {!reviewerSet && <li>{t('lifecycle.submit.needReviewer')}</li>}
              {!orderSet && <li>{t('lifecycle.submit.needOrder')}</li>}
            </ul>
          )}
          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!submitReady || pending !== null}
              aria-busy={pending === 'submit'}
              data-testid="document-lifecycle-submit"
              onClick={submitNow}
            >
              {t(ACTION_LABEL.submit)}
            </Button>
          </div>
        </div>
      )}

      {rowGestures.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {primary.length > 0 && <div className="flex min-w-fit grow gap-1.5">{primary.map(decisionButton)}</div>}
          <div className="flex min-w-fit grow items-center gap-1.5">
            {secondary.map(decisionButton)}
            {overflow.length > 0 && (
              <ActionMenu
                mode="dropdown"
                entries={overflow}
                trigger={
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="size-8 shrink-0"
                    aria-label={t('lifecycle.actions.more')}
                    title={t('lifecycle.actions.more')}
                    disabled={pending !== null}
                    data-testid="document-review-more"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                }
              />
            )}
          </div>
        </div>
      )}

      {approving && version && (
        <div
          className="space-y-2 rounded-surface border p-2.5"
          data-testid="document-review-approve-confirm"
        >
          <p className="text-xs font-medium" data-testid="document-review-approve-as-of">
            {t('lifecycle.approveConfirm.asOf', {
              number: shownNumber,
              date: formatAbsoluteTime(version.updatedAt, locale),
            })}
          </p>
          <p className="text-muted-foreground text-xs" data-testid="document-review-approve-acting">
            {actingName
              ? t('lifecycle.approveConfirm.actingWithName', { name: actingName, date: today })
              : t('lifecycle.approveConfirm.actingDateOnly', { date: today })}
          </p>
          {openMarks && (openMarks.status !== 'counted' || hasLiveMarks(openMarks)) && (
            <p
              className="text-xs leading-snug"
              role="note"
              data-testid="document-review-approve-open-marks"
              data-status={openMarks.status}
            >
              {openMarks.status === 'counted'
                ? t('lifecycle.approveConfirm.openMarks', { marks: openMarksLabel(t, locale, openMarks) })
                : openMarks.status === 'loading'
                  ? t('lifecycle.approveConfirm.openMarksLoading')
                  : t('lifecycle.approveConfirm.openMarksUnavailable')}
              {openMarks.status !== 'loading' && (
                <>
                  {' '}
                  <Button
                    type="button"
                    variant="inline"
                    data-testid="document-review-approve-open-marks-link"
                    onClick={openMarks.onOpen}
                  >
                    {t('annotations.openInReview')}
                  </Button>
                </>
              )}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="document-review-approve-checkbox"
              checked={approvedChecked}
              onCheckedChange={(checked) => setApprovedChecked(checked === true)}
              data-testid="document-review-approve-checkbox"
            />
            <label
              htmlFor="document-review-approve-checkbox"
              className="text-sm leading-snug"
            >
              {t('lifecycle.approveConfirm.checkbox')}
            </label>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setApproving(false)
                setApprovedChecked(false)
              }}
            >
              {t('lifecycle.comment.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!approvedChecked || pending !== null}
              data-testid="document-review-approve-send"
              onClick={confirmApprove}
            >
              {t(ACTION_LABEL.approve)}
            </Button>
          </div>
        </div>
      )}

      {typing && (
        <div className="space-y-2 rounded-surface border p-2.5" data-testid="document-review-comment">
          <label
            htmlFor="document-review-comment-input"
            className="text-muted-foreground block text-xs"
          >
            {t(
              typing === 'reject'
                ? 'lifecycle.comment.reasonLabel'
                : 'lifecycle.comment.changesLabel',
            )}
          </label>
          {/* What pressing this one does BEYOND sending the version back, said
              where the reviewer is deciding rather than in a tooltip: the label
              names the gesture, and this names its consequence. */}
          {typing === DELEGATE_REVISION && (
            <p className="text-muted-foreground text-xs" data-testid="document-review-delegate-note">
              {t('lifecycle.comment.delegateNote')}
            </p>
          )}
          <Textarea
            id="document-review-comment-input"
            value={comment}
            autoFocus
            rows={3}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('lifecycle.comment.placeholder')}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setTyping(null)
                setComment('')
              }}
            >
              {t('lifecycle.comment.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={comment.trim() === '' || pending !== null}
              data-testid="document-review-comment-send"
              onClick={send}
            >
              {t(ACTION_LABEL[typing])}
            </Button>
          </div>
        </div>
      )}

      {offersPublish && version && (
        <div className={cn('space-y-1.5', !publishBare && 'border-t pt-3')} data-testid="document-review-publish">
          {!publishBare && (
            <>
              <p className="text-xs font-medium">{t('lifecycle.publishSection.heading')}</p>
              <p className="text-muted-foreground text-xs">
                {t('lifecycle.publishSection.blurb', { number: shownNumber })}
              </p>
            </>
          )}
          <div>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={pending !== null}
              aria-busy={pending === 'publish'}
              data-testid="document-lifecycle-publish"
              onClick={() => start('publish')}
            >
              {t(ACTION_LABEL.publish)}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
