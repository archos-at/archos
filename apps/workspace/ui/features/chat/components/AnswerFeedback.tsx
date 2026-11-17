'use client'

import { useCallback, useRef, useState, type FC, type FormEvent } from 'react'
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react'
import { AnimatePresence, motion, useIconSwapTransition } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { PRESSABLE } from '@/components/ui/press'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { AnswerFeedbackReason } from '@/lib/db/schema/answer-feedback'
import { useChatStore } from '../store'
import { useAnswerFeedback } from '../hooks/use-answer-feedback'

const REASONS: readonly AnswerFeedbackReason[] = ['inaccurate', 'too_slow', 'wrong_source', 'other']

export interface AnswerFeedbackProps {
  messageId: string
  conversationId?: string | null
  compact?: boolean
  className?: string
  pending?: boolean
}

const thumbBase = cn(
  'inline-flex size-6 items-center justify-center rounded-control pointer-coarse:size-11',
  'text-muted-foreground',
  PRESSABLE,
  'hover:bg-hover hover:text-foreground',
  FOCUS_RING
)

const thumbSelected = 'bg-foreground text-background hover:bg-foreground hover:text-background'

export const AnswerFeedback: FC<AnswerFeedbackProps> = ({
  messageId,
  conversationId,
  compact = false,
  className,
  pending = false,
}) => {
  const t = useTranslations(chatCopy)
  const swap = useIconSwapTransition()
  const projectId = useChatStore((s) => s.projectId)
  const { state, setFeedback } = useAnswerFeedback(messageId, conversationId, projectId)
  const [comment, setComment] = useState('')
  const [expected, setExpected] = useState('')
  const receiptRef = useRef<HTMLParagraphElement>(null)

  const verdict = state?.verdict ?? null
  const reason = state?.reason ?? null
  const showNote = verdict === 'down' && !state?.comment && !state?.expectedAnswer
  const promptId = `answer-feedback-reason-${messageId}`
  const commentId = `answer-feedback-comment-${messageId}`
  const expectedId = `answer-feedback-expected-${messageId}`

  const handleUp = useCallback(() => {
    setComment('')
    setExpected('')
    setFeedback(
      verdict === 'up' ? null : { verdict: 'up', reason: null, comment: null, expectedAnswer: null }
    )
  }, [verdict, setFeedback])

  const handleDown = useCallback(() => {
    setComment('')
    setExpected('')
    setFeedback(
      verdict === 'down'
        ? null
        : { verdict: 'down', reason: null, comment: null, expectedAnswer: null }
    )
  }, [verdict, setFeedback])

  const handleReason = useCallback(
    (next: string) => {
      setFeedback({
        verdict: 'down',
        reason: next ? (next as AnswerFeedbackReason) : null,
        comment: state?.comment ?? null,
        expectedAnswer: state?.expectedAnswer ?? null,
      })
    },
    [setFeedback, state?.comment, state?.expectedAnswer]
  )

  const handleCommentSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const nextComment = comment.trim()
      const nextExpected = expected.trim()
      if (!nextComment && !nextExpected) return
      setFeedback({
        verdict: 'down',
        reason,
        comment: nextComment || null,
        expectedAnswer: nextExpected || null,
      })
      setComment('')
      setExpected('')
      receiptRef.current?.focus({ preventScroll: true })
    },
    [comment, expected, setFeedback, reason]
  )

  const restingRow = (
    <div
      className={cn(
        'group/feedback flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs',
        'duration-base transition-opacity ease-out motion-reduce:transition-none',
        pending && 'opacity-0',
        compact && className
      )}
      inert={pending}
      aria-hidden={pending || undefined}
    >
      {/* One slot, two states: the question and the receipt are stacked in the
          same grid cell and cross-fade, so the slot is as wide as the wider of
          the two from the first frame and the thumbs beside it never move. */}
      <span className="grid items-center">
        <span
          aria-hidden={verdict !== null || undefined}
          className={cn(
            'text-muted-foreground group-hover/feedback:text-muted-foreground col-start-1 row-start-1 text-xs',
            'duration-quick transition-[color,opacity] ease-out motion-reduce:transition-none',
            verdict !== null && 'opacity-0'
          )}
        >
          {t('feedback.question')}
        </span>
        {/* What the vote alone commits, stated once, on the vote's own line. */}
        <p
          ref={receiptRef}
          role="status"
          tabIndex={-1}
          className={cn(
            'text-muted-foreground col-start-1 row-start-1 flex items-center gap-1 text-xs outline-none',
            'duration-quick transition-opacity ease-out motion-reduce:transition-none',
            verdict === null && 'opacity-0'
          )}
        >
          {verdict !== null && (
            <>
              {/* Only the mark moves; the sentence is legible from frame one. */}
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: swap.enter }}
                className="inline-flex"
                aria-hidden="true"
              >
                <Check className="size-3" />
              </motion.span>
              {/* What the press COMMITTED, not gratitude. The vote is persisted
                  on the press, so this line is the receipt for it — while the
                  reason and the note below are a second, optional act. Thanking
                  here read as if the exchange were over, directly under an open
                  "Was war das Problem?". */}
              {t('feedback.voteRecorded')}
            </>
          )}
        </p>
      </span>
      <div className="flex items-center gap-1">
        <button data-attr="chat-up"
          type="button"
          onClick={handleUp}
          aria-pressed={verdict === 'up'}
          aria-label={t('feedback.helpfulAria')}
          className={cn(thumbBase, verdict === 'up' && thumbSelected)}
        >
          <ThumbsUp className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
        </button>
        <button data-attr="chat-down"
          type="button"
          onClick={handleDown}
          aria-pressed={verdict === 'down'}
          aria-label={t('feedback.notHelpfulAria')}
          className={cn(thumbBase, verdict === 'down' && thumbSelected)}
        >
          <ThumbsDown className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )

  const disclosure = (
    <AnimatePresence initial={false}>
      {verdict === 'down' && (
        <HeightArrival key="reasons" className="w-full">
          <div className="flex max-w-md flex-col gap-2 text-xs">
            <p id={promptId} className="text-muted-foreground text-xs">
              {t('feedback.reasonPrompt')}
            </p>
            {/* Exclusive choice, structurally: Radix renders a radiogroup with
            roving-focus arrow keys, so the chips are one tab stop. */}
            <ToggleGroup
              type="single"
              value={reason ?? ''}
              onValueChange={handleReason}
              variant="outline"
              size="sm"
              aria-labelledby={promptId}
              className="gap-1.5"
            >
              {REASONS.map((key) => (
                <ToggleGroupItem
                  key={key}
                  value={key}
                  className="data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:shadow-2xs h-7 px-2.5 text-xs data-[state=on]:border-transparent pointer-coarse:h-11"
                >
                  {t(`feedback.reasons.${key}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <AnimatePresence initial={false}>
              {showNote && (
                <HeightArrival key="note">
                  <form onSubmit={handleCommentSubmit}>
                    <Field className="gap-1.5">
                      <FieldLabel
                        htmlFor={commentId}
                        className="text-muted-foreground text-xs font-normal"
                      >
                        {t('feedback.commentLabel')}
                      </FieldLabel>
                      <Textarea
                        id={commentId}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder={t('feedback.commentPlaceholder')}
                        rows={2}
                        maxLength={2000}
                        className="min-h-14 resize-none rounded-control py-2 text-xs"
                      />
                      <FieldLabel
                        htmlFor={expectedId}
                        className="text-muted-foreground text-xs font-normal"
                      >
                        {t('feedback.expectedLabel')}
                      </FieldLabel>
                      <Input
                        id={expectedId}
                        value={expected}
                        onChange={(event) => setExpected(event.target.value)}
                        placeholder={t('feedback.expectedPlaceholder')}
                        maxLength={2000}
                        className="h-8 rounded-control text-xs"
                      />
                      {/* Full ink when it will do something, 40% when it will not:
                  the difference is a contrast jump, not grey vs. grey. */}
                      <Button
                        type="submit"
                        size="sm"
                        className="h-7 w-fit px-3 text-xs disabled:opacity-40 pointer-coarse:h-11"
                        disabled={comment.trim() === '' && expected.trim() === ''}
                      >
                        {t('feedback.commentSubmit')}
                      </Button>
                    </Field>
                  </form>
                </HeightArrival>
              )}
            </AnimatePresence>
          </div>
        </HeightArrival>
      )}
    </AnimatePresence>
  )

  if (compact) {
    return (
      <>
        {restingRow}
        {disclosure}
      </>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {restingRow}
      {disclosure}
    </div>
  )
}
