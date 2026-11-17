'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { ArrowUp, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import {
  MentionPicker,
  type MentionPickerAria,
  type MentionPickerHandle,
} from '@/features/collaboration/components/MentionPicker'
import {
  findMentionQuery,
  insertMention,
  reconcileMentions,
  splitMentionSegments,
  type DraftMention,
  type MentionQuery,
} from '@/lib/mentions/mention-text'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { filesCopy } from '@/i18n/namespaces/files'
import { AnnotationRequestError } from '@/lib/annotations/client'
import { MAX_ANNOTATION_BODY, type MarkMention } from '@/lib/annotations/types'
import { MAX_MENTIONS_PER_MESSAGE } from '@/lib/limits/catalog'
import { isAgentMentionId, MENTION_ERROR_REASONS, type MentionCandidate } from '@/lib/mentions/types'
import { LEGACY_AGENT_MENTION_ID } from '@/lib/mentions/legacy-mention-ids'
import { cn } from '@/lib/utils'
import { useMentionablePeople } from '../../hooks/use-mentionable-people'

export interface ComposerSend {
  piloti: boolean
  mentions: MarkMention[]
}

function withoutMention(text: string, mentions: readonly DraftMention[], isTarget: (targetId: string) => boolean): string {
  const segments = splitMentionSegments(text, mentions)
  let out = ''
  let dropSpace = false
  for (const segment of segments) {
    if (segment.kind === 'mention' && isTarget(segment.targetId)) {
      dropSpace = true
      continue
    }
    out += dropSpace ? segment.text.replace(/^ /, '') : segment.text
    dropSpace = false
  }
  return out
}

export function Composer({
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onEscape,
  onAskAgent,
  mentionAgent,
  documentId,
  pickerSide = 'below',
  maxLength = MAX_ANNOTATION_BODY,
  initialBody = '',
  initialMentions,
  describeFailure,
  testId,
}: {
  placeholder: string
  submitLabel: string
  autoFocus?: boolean
  onSubmit: (body: string, options: ComposerSend) => Promise<readonly MarkMention[] | void>
  onEscape?: () => void
  onAskAgent?: (body: string) => void
  mentionAgent?: boolean
  documentId?: string
  pickerSide?: 'above' | 'below'
  maxLength?: number
  initialBody?: string
  initialMentions?: readonly MarkMention[]
  describeFailure?: (error: unknown) => string | null
  testId: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const tCollab = useTranslations(collaborationCopy)
  const agentName = tCollab('mentions.picker.agentName')
  const [body, setBody] = useState(initialBody)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [picked, setPicked] = useState<DraftMention[]>(() => reconcileMentions(initialBody, [...(initialMentions ?? [])]))
  const [query, setQuery] = useState<MentionQuery | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [aria, setAria] = useState<MentionPickerAria>({ listboxId: null, activeOptionId: null })
  const [untold, setUntold] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const pickerRef = useRef<MentionPickerHandle>(null)
  const pendingCaret = useRef<number | null>(autoFocus && initialBody ? initialBody.length : null)
  const { people, loading, failed: peopleFailed } = useMentionablePeople(documentId ?? null, attempt)
  const mentionsOn = Boolean(mentionAgent || documentId)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${Math.min(node.scrollHeight, 144)}px`
    const caret = pendingCaret.current
    if (caret === null) return
    pendingCaret.current = null
    node.focus()
    node.setSelectionRange(caret, caret)
  }, [body])

  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...(mentionAgent
        ? [
            {
              targetId: LEGACY_AGENT_MENTION_ID,
              person: { userId: LEGACY_AGENT_MENTION_ID, name: agentName, email: null, profilePictureUrl: null },
              isAgent: true,
              isParticipant: true,
              needsInvite: false,
            },
          ]
        : []),
      ...people.map((person) => ({
        targetId: person.userId,
        person,
        isAgent: false,
        isParticipant: false,
        needsInvite: false,
      })),
    ],
    [mentionAgent, agentName, people]
  )
  const standing = useMemo(() => reconcileMentions(body, picked), [body, picked])
  const agentMentioned = standing.some((mention) => isAgentMentionId(mention.targetId))
  const pickerOpen = mentionsOn && query !== null && !dismissed

  const syncQuery = (text: string, caret: number | null) => {
    if (!mentionsOn) return
    const next = caret === null ? null : findMentionQuery(text, caret)
    if (next && (!query || query.start !== next.start)) setAttempt((count) => count + 1)
    setQuery(next)
    if (!next) setDismissed(false)
  }

  const change = (text: string, caret: number | null) => {
    setBody(text)
    setPicked((current) => reconcileMentions(text, current))
    setUntold([])
    syncQuery(text, caret)
  }

  const select = useCallback(
    (candidate: MentionCandidate) => {
      if (!query) return
      const display = candidate.isAgent ? agentName : candidate.person.name
      const next = insertMention(body, query, display)
      pendingCaret.current = next.caret
      setBody(next.text)
      setPicked((current) => [...current, { targetId: candidate.targetId, display }])
      setQuery(null)
      setDismissed(false)
    },
    [agentName, body, query]
  )

  const toggleAgent = () => {
    if (agentMentioned) {
      const text = withoutMention(body, picked, isAgentMentionId)
      setBody(text)
      setPicked((current) => reconcileMentions(text, current))
    } else {
      const token = `@${agentName} `
      pendingCaret.current = token.length + body.length
      setBody(`${token}${body}`)
      setPicked((current) => [...current, { targetId: LEGACY_AGENT_MENTION_ID, display: agentName }])
    }
    ref.current?.focus()
  }

  const submit = async () => {
    const text = body.trim()
    if (!text || busy) return
    const sent = reconcileMentions(text, picked)
    const mentions = [...new Map(sent.map((mention) => [mention.targetId, mention])).values()]
    if (mentions.length > MAX_MENTIONS_PER_MESSAGE) {
      setFailed(t('review.mentions.tooMany', { max: MAX_MENTIONS_PER_MESSAGE }))
      return
    }
    setBusy(true)
    setFailed(null)
    try {
      const kept = await onSubmit(body, {
        piloti: sent.some((mention) => isAgentMentionId(mention.targetId)),
        mentions,
      })
      setBody('')
      setPicked([])
      setQuery(null)
      const keptIds = kept ? new Set(kept.map((mention) => mention.targetId)) : null
      setUntold(
        keptIds
          ? mentions
              .filter((mention) => !isAgentMentionId(mention.targetId) && !keptIds.has(mention.targetId))
              .map((mention) => mention.display)
          : []
      )
    } catch (error) {
      const rateLimited = error instanceof AnnotationRequestError && error.reason === MENTION_ERROR_REASONS.rateLimited
      setFailed(
        rateLimited
          ? tCollab('mentions.errors.rateLimited')
          : (describeFailure?.(error) ?? t('review.sendFailed'))
      )
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (pickerOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        pickerRef.current?.move(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        if (pickerRef.current?.selectActive()) return
        setDismissed(true)
        if (event.key === 'Enter') void submit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(true)
        return
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onAskAgent) {
      event.preventDefault()
      onAskAgent(body.trim())
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
    if (event.key === 'Escape' && onEscape) {
      event.stopPropagation()
      onEscape()
    }
  }

  const agentButton = onAskAgent ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 rounded-full [&_svg]:size-3.5"
      aria-label={t('review.piloti.ask')}
      title={`${t('review.piloti.ask')} (⌘↵)`}
      data-testid={`${testId}-piloti`}
      onClick={() => onAskAgent(body.trim())}
    >
      <Sparkles aria-hidden />
    </Button>
  ) : mentionAgent ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-6 shrink-0 rounded-full [&_svg]:size-3.5', agentMentioned && 'bg-accent text-foreground')}
      aria-label={t('review.piloti.mention')}
      aria-pressed={agentMentioned}
      title={t('review.piloti.mentionHint')}
      data-testid={`${testId}-mention`}
      onClick={toggleAgent}
    >
      <Sparkles aria-hidden />
    </Button>
  ) : null

  return (
    <div className="relative">
      <div className="bg-input-background focus-within:border-foreground/40 rounded-bubble border px-2.5 py-1.5 transition-colors duration-quick ease-out">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={ref}
            data-testid={testId}
            aria-label={placeholder}
            role={pickerOpen ? 'combobox' : undefined}
            aria-autocomplete={pickerOpen ? 'list' : undefined}
            aria-expanded={pickerOpen ? true : undefined}
            aria-haspopup={pickerOpen ? 'listbox' : undefined}
            aria-controls={pickerOpen ? (aria.listboxId ?? undefined) : undefined}
            aria-activedescendant={pickerOpen ? (aria.activeOptionId ?? undefined) : undefined}
            rows={1}
            value={body}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => change(event.target.value, event.target.selectionStart)}
            onSelect={(event) => syncQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
            onBlur={() => setQuery(null)}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
            className="placeholder:text-muted-foreground min-h-6 flex-1 resize-none border-0 bg-transparent py-0.5 text-[13px] leading-5 shadow-none outline-none! ring-0 focus-visible:ring-0 pointer-coarse:text-base"
          />
          {agentButton}
          <Button
            type="button"
            size="icon"
            className="touch-target size-6 shrink-0 rounded-full pointer-coarse:size-8 pointer-coarse:min-w-0 [&_svg]:size-3.5 pointer-coarse:[&_svg]:size-4"
            disabled={!body.trim() || busy}
            aria-label={submitLabel}
            title={`${submitLabel} (Enter)`}
            data-testid={`${testId}-send`}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void submit()}
          >
            <ArrowUp aria-hidden />
          </Button>
        </div>
      </div>
      {pickerOpen && (
        <div
          className={cn('absolute inset-x-0 z-20', pickerSide === 'above' ? 'bottom-full mb-1' : 'top-full mt-1')}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <MentionPicker
            ref={pickerRef}
            query={query?.query ?? ''}
            candidates={candidates}
            canInvite={false}
            loading={loading && candidates.length === 0}
            onSelect={select}
            onAriaChange={setAria}
            othersHeading={t('review.mentions.othersHeading')}
            noResultsHint={t('review.mentions.noResultsHint')}
            notice={peopleFailed ? t('review.mentions.peopleFailed') : undefined}
            className="max-h-64"
          />
        </div>
      )}
      {untold.length > 0 && (
        <p className="text-muted-foreground mt-1 text-[11px] leading-4" role="status" data-testid={`${testId}-untold`}>
          {untold.length === 1
            ? t('review.mentions.untoldOne', { name: untold[0] })
            : t('review.mentions.untoldMany', { names: untold.join(', ') })}
        </p>
      )}
      {failed && <FieldError className="mt-1">{failed}</FieldError>}
    </div>
  )
}
