'use client'

import { useCallback, useEffect, useId, useMemo, type KeyboardEvent, type ReactNode } from 'react'
import { useMachine } from '@xstate/react'
import { answerFooterMachine, openPanel } from '../../lib/answer-footer-machine'
import { useAnswerFeedback } from '../../hooks/use-answer-feedback'
import { useChatStore } from '../../store'
import { AnswerFeedbackReasons, AnswerFeedbackThumbs } from '../AnswerFeedback'
import { AnswerSourcesRow } from '../AnswerSourcesRow'
import { RetryThoroughButton } from '../RetryThoroughButton'
import { AnswerDetailsBody, AnswerDetailsTrigger, detailsNeedAttention } from './answer-details'
import { AnswerFooterContext } from './footer-context'
import { FooterDrawer } from './footer-drawer'
import type { useAgentResponseController } from './use-agent-response-controller'

type Controller = ReturnType<typeof useAgentResponseController>

export function AnswerFooter({
  controller,
  sources,
  withActions = true,
}: {
  controller: Controller
  sources: ReactNode
  withActions?: boolean
}) {
  const [snapshot, send] = useMachine(answerFooterMachine)
  const panel = openPanel(snapshot)
  const drawerId = `answer-footer-drawer-${useId()}`
  const footer = useMemo(() => ({ panel, send, drawerId }), [panel, send, drawerId])

  const messageId = controller.messageId ?? ''
  const projectId = useChatStore((s) => s.projectId)
  const { state: vote, setFeedback } = useAnswerFeedback(messageId, controller.conversationId, projectId)
  const showVote = controller.hasFeedback && Boolean(controller.messageId)
  const onVerdict = useCallback(
    (verdict: 'up' | 'down' | null) =>
      send(verdict === 'down' ? { type: 'open', panel: 'reasons' } : { type: 'close', panel: 'reasons' }),
    [send]
  )
  useEffect(() => {
    if (vote?.verdict !== 'down') send({ type: 'close', panel: 'reasons' })
  }, [vote?.verdict, send])

  const details = {
    hasConfidence: controller.hasConfidence,
    answerConfidence: controller.answerConfidence,
    answerConfidenceCappedReason: controller.answerConfidenceCappedReason,
    answerConfidenceReason: controller.answerConfidenceReason,
    confidenceCheck: controller.confidenceCheck,
    answerConfidenceVersion: controller.answerConfidenceVersion,
    skillsActivated: controller.skillsActivated,
    skillsHidden: controller.skillsHidden,
    showReasoning: controller.showReasoning,
    researchTruncated: controller.researchTruncated,
    truncationReason: controller.truncationReason,
    degradedReasons: controller.degradedReasons,
    citationsRemoved: controller.citationsRemoved,
    readSources: controller.readSources,
    hasAnswerSources: controller.hasAnswerSources,
    timestamp: controller.timestamp,
    answerDurationMs: controller.answerDurationMs,
    conversationId: controller.conversationId,
    messageId: controller.messageId,
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && panel) {
      event.stopPropagation()
      send({ type: 'escape' })
    }
  }

  const actions = withActions ? controller.answerActions : null
  const vote$ = showVote ? (
    <>
      {!controller.inert && (
        <RetryThoroughButton messageId={messageId} conversationId={controller.conversationId} />
      )}
      <AnswerFeedbackThumbs
        messageId={messageId}
        state={vote}
        setFeedback={setFeedback}
        onVerdict={onVerdict}
        pending={controller.inert}
      />
    </>
  ) : null

  return (
    <AnswerFooterContext.Provider value={footer}>
      <div onKeyDown={onKeyDown}>
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5">
          {sources}
          {controller.memoryChip}
          <div className="-mr-[5px] ml-auto flex items-center justify-end gap-0.5 pointer-coarse:mr-0">
            {actions}
            {controller.hasDetailsContent && (
              <AnswerDetailsTrigger
                open={panel === 'details'}
                onToggle={() => send({ type: 'toggle', panel: 'details' })}
                needsAttention={detailsNeedAttention(details)}
                controls={drawerId}
              />
            )}
            {(actions || controller.hasDetailsContent) && vote$ && (
              <span className="bg-border mx-1 h-3.5 w-px" aria-hidden="true" />
            )}
            {vote$}
          </div>
        </div>
        <FooterDrawer id={drawerId} panel={panel}>
          {(shown) =>
            shown === 'sources' ? (
              <AnswerSourcesRow documents={controller.documents} layout="list" />
            ) : shown === 'details' ? (
              <AnswerDetailsBody {...details} />
            ) : (
              <AnswerFeedbackReasons messageId={messageId} state={vote} setFeedback={setFeedback} />
            )
          }
        </FooterDrawer>
      </div>
    </AnswerFooterContext.Provider>
  )
}
