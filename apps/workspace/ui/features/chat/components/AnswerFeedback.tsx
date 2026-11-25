'use client'

import { useCallback, useState, type FC, type FormEvent } from 'react'
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react'
import { AnimatePresence, motion, useIconSwapTransition } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { PRESSABLE } from '@/components/ui/press'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import type { AnswerFeedbackReason } from '@/lib/db/schema/answer-feedback'
import { useChatStore } from '../store'
import {
  useAnswerFeedback,
  type AnswerFeedbackState,
} from '../hooks/use-answer-feedback'

const REASONS: readonly AnswerFeedbackReason[] = ['inaccurate', 'too_slow', 'wrong_source', 'other']

const thumbBase = cn(
  'inline-flex size-6 items-center justify-center rounded-control pointer-coarse:size-11',
  'text-muted-foreground',
  PRESSABLE,
  'hover:bg-hover hover:text-foreground',
  FOCUS_RING
)

const thumbSelected = 'bg-foreground text-background hover:bg-foreground hover:text-background'

type SetFeedback = (next: AnswerFeedbackState | null) => void
type Verdict = AnswerFeedbackState['verdict'] | null

const receiptIdFor = (messageId: string): string => `answer-feedback-receipt-${messageId}`

export interface AnswerFeedbackThumbsProps {
  messageId: string
  state: AnswerFeedbackState | null
  setFeedback: SetFeedback
  onVerdict?: (verdict: Verdict) => void
  pending?: boolean
  className?: string
}

export const AnswerFeedbackThumbs: FC<AnswerFeedbackThumbsProps> = ({
  messageId,
  state,
  setFeedback,
  onVerdict,
  pending = false,
  className,
}) => {
  const t = useTranslations(chatCopy)
  const swap = useIconSwapTransition()
  const verdict = state?.verdict ?? null
  const receiptId = receiptIdFor(messageId)

  const handleUp = useCallback(() => {
    const next = verdict === 'up' ? null : 'up'
    setFeedback(next ? { verdict: next, reason: null, comment: null, expectedAnswer: null } : null)
    onVerdict?.(next)
  }, [verdict, setFeedback, onVerdict])

  const handleDown = useCallback(() => {
    const next = verdict === 'down' ? null : 'down'
    setFeedback(next ? { verdict: next, reason: null, comment: null, expectedAnswer: null } : null)
    onVerdict?.(next)
  }, [verdict, setFeedback, onVerdict])

  return (
    <div
      className={cn(
        'group/feedback flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs',
        'duration-base transition-opacity ease-out motion-reduce:transition-none',
        pending && 'opacity-0',
        className
      )}
      inert={pending}
      aria-hidden={pending || undefined}
    >
      {/* What the vote alone commits, stated once, on the vote's own line. */}
      <p
        id={receiptId}
        role="status"
        tabIndex={-1}
        className={cn(
          'sr-only',
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
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-attr="chat-up"
              type="button"
              onClick={handleUp}
              aria-pressed={verdict === 'up'}
              aria-label={t('feedback.helpfulAria')}
              className={cn(thumbBase, verdict === 'up' && thumbSelected)}
            >
              <ThumbsUp className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t(verdict === 'up' ? 'feedback.voteRecorded' : 'feedback.question')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-attr="chat-down"
              type="button"
              onClick={handleDown}
              aria-pressed={verdict === 'down'}
              aria-label={t('feedback.notHelpfulAria')}
              className={cn(thumbBase, verdict === 'down' && thumbSelected)}
            >
              <ThumbsDown className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t(verdict === 'down' ? 'feedback.voteRecorded' : 'feedback.question')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export interface AnswerFeedbackReasonsProps {
  messageId: string
  state: AnswerFeedbackState | null
  setFeedback: SetFeedback
}

export const AnswerFeedbackReasons: FC<AnswerFeedbackReasonsProps> = ({
  messageId,
  state,
  setFeedback,
}) => {
  const t = useTranslations(chatCopy)
  const [comment, setComment] = useState('')
  const [expected, setExpected] = useState('')
  const reason = state?.reason ?? null
  const showNote = state?.verdict === 'down' && !state?.comment && !state?.expectedAnswer
  const promptId = `answer-feedback-reason-${messageId}`
  const commentId = `answer-feedback-comment-${messageId}`
  const expectedId = `answer-feedback-expected-${messageId}`

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
      document.getElementById(receiptIdFor(messageId))?.focus({ preventScroll: true })
    },
    [comment, expected, setFeedback, reason, messageId]
  )

  return (
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
            className="data-[state=on]:bg-foreground data-[state=on]:text-background h-7 px-2.5 text-xs data-[state=on]:border-transparent data-[state=on]:shadow-2xs pointer-coarse:h-11"
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
                  className="rounded-control min-h-14 resize-none py-2 text-xs"
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
                  className="rounded-control h-8 text-xs"
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
  )
}

export interface AnswerFeedbackProps {
  messageId: string
  conversationId?: string | null
  className?: string
  pending?: boolean
}

export const AnswerFeedback: FC<AnswerFeedbackProps> = ({
  messageId,
  conversationId,
  className,
  pending = false,
}) => {
  const projectId = useChatStore((s) => s.projectId)
  const { state, setFeedback } = useAnswerFeedback(messageId, conversationId, projectId)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AnswerFeedbackThumbs
        messageId={messageId}
        state={state}
        setFeedback={setFeedback}
        pending={pending}
      />
      <AnimatePresence initial={false}>
        {state?.verdict === 'down' && (
          <HeightArrival key="reasons" className="w-full">
            <AnswerFeedbackReasons messageId={messageId} state={state} setFeedback={setFeedback} />
          </HeightArrival>
        )}
      </AnimatePresence>
    </div>
  )
}
