'use client'

import { type FC, type ReactNode, useCallback, useMemo, useState } from 'react'
import { ChevronDown, MessageSquare } from 'lucide-react'
import { useIsPresent } from 'motion/react'
import { AnimatePresence, motion, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DECISION_BUTTON, DECISION_ROW } from '@/features/cards/components/card-chrome'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatTime } from '@/shared/utils/format-time'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { BranchOptions } from './reasoning/BranchOptions'
import { useChatStore } from '../store'
import { useLayoutStore } from '@/features/layout/store'
import {
  approvalReply,
  parsePlanFence,
  PlanChecklist,
  planFromReply,
  stripPlanFence,
  type PlanShape,
} from './PlanChecklist'
import type { StoredPromptOption } from '@/lib/conversations/message-prompt'

const APPROVAL_PROMPT_RE =
  /Reply\s+\*{0,2}approve\*{0,2}\s+to proceed,\s+\*{0,2}shallow\*{0,2}\s+for a quick answer instead/i

const APPROVAL_PROMPT_STRIP_RE = /[ \t]*Reply\s+\*{0,2}approve\*{0,2}\s+to proceed,[^\n]*/i

const PLAN_HEADER_RE = /\*\*Research Plan Preview\*\*/
const PLAN_TITLE_LABEL_RE = /\*\*Title:\*\*/
const PLAN_SECTIONS_LABEL_RE = /\*\*Sections:\*\*/
const PLAN_SECTIONS_BLOCK_RE = /\*\*[^*\n]+\*\*\s*\n(?:\s*\d+\.\s[^\n]*\n?)+/

const APPROVAL_RESPONSE_KEYS: Record<string, string> = {
  approve: 'agentPrompt.responseApproved',
  shallow: 'agentPrompt.responseShallow',
  cancel: 'agentPrompt.responseCancelled',
}

export interface AgentPromptProps {
  content: string
  options?: StoredPromptOption[]
  isResponded?: boolean
  response?: string
  timestamp?: Date | string
  isAddressee?: boolean
  addresseeName?: string | null
}

export const AgentPrompt: FC<AgentPromptProps> = ({
  content,
  options = [],
  isResponded = false,
  response,
  timestamp,
  isAddressee = true,
  addresseeName,
}) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const respondToInteractionFn = useChatStore((state) => state.respondToInteractionFn)
  const isApprovalPrompt = APPROVAL_PROMPT_RE.test(content)
  const showApprovalButtons =
    isApprovalPrompt && !isResponded && !!respondToInteractionFn && isAddressee
  const plan = useMemo(
    () => (isApprovalPrompt ? parsePlanFence(content) : null),
    [content, isApprovalPrompt]
  )
  const [editedPlan, setEditedPlan] = useState<PlanShape | null>(null)
  const shownPlan = editedPlan ?? plan
  const enabledSourceIds = useLayoutStore((s) => s.enabledDataSourceIds)
  const availableSources = useLayoutStore((s) => s.availableDataSources)
  const frame = useMemo(() => {
    if (!plan) return undefined
    const ids = enabledSourceIds.filter((id) => (availableSources ?? []).some((s) => s.id === id))
    const labels = ids.map((id) => (availableSources ?? []).find((s) => s.id === id)?.name ?? id)
    return { ids, labels }
  }, [plan, enabledSourceIds, availableSources])
  const displayContent = isApprovalPrompt
    ? stripPlanFence(content)
        .replace(APPROVAL_PROMPT_STRIP_RE, '')
        .replace(PLAN_HEADER_RE, `**${t('agentPrompt.planPreviewHeading')}**`)
        .replace(PLAN_TITLE_LABEL_RE, `**${t('agentPrompt.planTitleLabel')}**`)
        .replace(PLAN_SECTIONS_LABEL_RE, `**${t('agentPrompt.planSectionsLabel')}**`)
        .trim()
    : content
  const bubbleContent = plan
    ? displayContent.replace(PLAN_SECTIONS_BLOCK_RE, '').trim()
    : displayContent

  const responseKey =
    isApprovalPrompt && response
      ? APPROVAL_RESPONSE_KEYS[response.trim().toLowerCase().split(/\s/)[0] ?? '']
      : undefined
  const responseLabel = responseKey ? t(responseKey) : response

  const handleApprove = useCallback(() => {
    if (isResponded) return
    respondToInteractionFn?.(
      plan && shownPlan ? approvalReply(plan, shownPlan, frame?.ids ?? []) : 'approve'
    )
  }, [isResponded, respondToInteractionFn, plan, shownPlan, frame])

  const handleShallow = useCallback(() => {
    if (isResponded) return
    respondToInteractionFn?.('shallow')
  }, [isResponded, respondToInteractionFn])

  const handleCancel = useCallback(() => {
    if (isResponded) return
    respondToInteractionFn?.('cancel')
  }, [isResponded, respondToInteractionFn])

  const decidedPlan = useMemo(
    () => (plan ? (editedPlan ?? planFromReply(plan, response)) : null),
    [plan, editedPlan, response]
  )
  const approved = responseKey === APPROVAL_RESPONSE_KEYS.approve
  const recordLabel =
    plan && approved && decidedPlan
      ? t('agentPrompt.planRecord', { count: decidedPlan.sections.length })
      : responseLabel

  const optionLabels = useMemo(() => options.map((option) => option.label), [options])
  const selectedLabel = options.find((option) => option.id === response)?.label
  const handleSelect = useCallback(
    (label: string) => {
      if (isResponded) return
      const option = options.find((candidate) => candidate.label === label)
      if (option) respondToInteractionFn?.(option.id)
    },
    [isResponded, options, respondToInteractionFn]
  )

  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[85%] flex-col">
        <div className="bg-card flex flex-col gap-3 overflow-hidden break-words rounded-surface rounded-bl-md p-4">
          {/* Agent icon and label */}
          <div
            className={`duration-quick flex items-center gap-2 transition-opacity ease-out motion-reduce:transition-none ${isResponded ? 'opacity-75' : ''}`}
          >
            <MessageSquare className="text-muted-foreground size-5" />
            <span className="text-muted-foreground text-sm font-medium">
              {isResponded ? t('agentPrompt.receivedInput') : t('agentPrompt.needsInput')}
            </span>
          </div>

          {/* Content - rendered as markdown */}
          <div
            className={`prose prose-sm duration-quick max-w-none transition-opacity ease-out motion-reduce:transition-none ${isResponded ? 'opacity-75' : ''}`}
          >
            <MarkdownRenderer content={bubbleContent} />
          </div>

          {/* Choice prompts render as the shared Folgewege branch-picker cards
              (same look as the trace's BranchesNode). After answering, the
              chosen card stays selected and the rest dim, so the picker doubles
              as the response display. */}
          {options.length > 0 && (
            <BranchOptions
              options={optionLabels}
              selected={isResponded ? selectedLabel : undefined}
              isResponded={isResponded || !isAddressee}
              onSelect={isAddressee && respondToInteractionFn ? handleSelect : undefined}
              digitShortcuts={isAddressee}
            />
          )}

          {/* The decision and its receipt, one slot (see the module note). */}
          <AnswerSlot answered={isResponded}>
            {isResponded ? (
              <>
                {/* A colleague's settled list for a choice prompt is the options
                    above; every other prompt echoes its answer here. */}
                {options.length === 0 && plan && decidedPlan ? (
                  <PlanRecord label={recordLabel} plan={decidedPlan} frame={frame} />
                ) : (
                  options.length === 0 && <ResponseDisplay response={responseLabel} />
                )}
              </>
            ) : (
              <>
                {shownPlan && (
                  <PlanChecklist
                    plan={shownPlan}
                    disabled={!isAddressee || !respondToInteractionFn}
                    frame={frame}
                    onChange={setEditedPlan}
                  />
                )}

                {/* Why a colleague has no buttons. Without a line here the card
                    reads as broken rather than as somebody else's turn. */}
                {!isAddressee && (
                  <p data-testid="agent-prompt-awaiting-other" className="text-muted-foreground text-xs">
                    {addresseeName
                      ? t('agentPrompt.awaitingOther', { name: addresseeName })
                      : t('agentPrompt.awaitingSomeone')}
                  </p>
                )}

                {/* Localized instruction + duration/cost expectation for plan
                    approval prompts, shown at the decision point. */}
                {isApprovalPrompt && isAddressee && (
                  <div className="flex flex-col gap-1">
                    <span className="text-foreground text-sm">
                      {t('agentPrompt.approvalInstructionThreeWay')}
                    </span>
                    <span className="text-muted-foreground text-xs">{t('agentPrompt.durationHint')}</span>
                  </div>
                )}

                {/* The plan decision: the deep run first, then a quick shallow
                    answer instead, then cancel outright. The card chrome's
                    decision row: stacked and full width on a phone, where the
                    primary used to wrap alone onto a second line, and in the
                    reading order of the other decisions (the main action
                    first). */}
                {showApprovalButtons && (
                  <div className={DECISION_ROW}>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleApprove}
                      aria-label={t('agentPrompt.approvePlan')}
                      className={DECISION_BUTTON}
                    >
                      {t('agentPrompt.startResearch')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleShallow}
                      aria-label={t('agentPrompt.answerShallowAria')}
                      className={DECISION_BUTTON}
                    >
                      {t('agentPrompt.answerShallow')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      aria-label={t('agentPrompt.cancelResearchAria')}
                      className={DECISION_BUTTON}
                    >
                      {t('agentPrompt.cancelResearch')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </AnswerSlot>
        </div>

        {/* Timestamp outside bubble, right-aligned */}
        {timestamp && (
          <span className="text-subtle mr-3 mt-1 self-end text-xs">
            {formatTime(timestamp, locale)}
          </span>
        )}
      </div>
    </div>
  )
}

const ResponseDisplay: FC<{ response?: string }> = ({ response }) => {
  const t = useTranslations(chatCopy)
  if (!response) return null

  return (
    <div className="bg-muted flex items-center gap-2 rounded-control px-3 py-2">
      <MessageSquare className="text-subtle size-4" />
      <span className="text-subtle text-sm">
        {t('agentPrompt.yourResponse')} <span className="text-primary">{response}</span>
      </span>
    </div>
  )
}

const AnswerSlot: FC<{ answered: boolean; children: ReactNode }> = ({ answered, children }) => (
  <AnimatePresence mode="wait" initial={false}>
    <AnswerSlotBody key={answered ? 'answered' : 'open'}>{children}</AnswerSlotBody>
  </AnimatePresence>
)

const AnswerSlotBody: FC<{ children: ReactNode }> = ({ children }) => {
  const reduced = useReducedMotion()
  const present = useIsPresent()
  return (
    <motion.div
      className={cn('flex flex-col gap-3 empty:hidden', !present && 'pointer-events-none')}
      aria-hidden={present ? undefined : true}
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: reduced ? motionInstant : motionQuick }}
      exit={{ opacity: 0, transition: reduced ? motionInstant : motionQuickExit }}
    >
      {children}
    </motion.div>
  )
}

const PlanRecord: FC<{
  label?: string
  plan: PlanShape
  frame?: { ids: string[]; labels: string[] }
}> = ({ label, plan, frame }) => {
  const t = useTranslations(chatCopy)
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <div className="bg-muted flex items-center gap-2 rounded-control px-3 py-2" data-testid="plan-record">
        <MessageSquare className="text-subtle size-4 shrink-0" aria-hidden />
        <span className="text-subtle min-w-0 flex-1 text-sm">{label}</span>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground group h-7 shrink-0 gap-1 px-2 text-xs"
            data-testid="plan-record-toggle"
          >
            {open ? t('agentPrompt.hidePlan') : t('agentPrompt.showPlan')}
            <ChevronDown
              className="duration-quick size-3.5 transition-transform ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <PlanChecklist plan={plan} disabled frame={frame} onChange={() => undefined} />
      </CollapsibleContent>
    </Collapsible>
  )
}
