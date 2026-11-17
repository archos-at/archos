import { ChatThinking } from '@/features/chat'
import { FollowUpsRail } from '@/features/chat/components/FollowUpsRail'
import { offersFileNote } from '@/features/chat/lib/file-note-chip'
import { previousRunFindings } from '@/features/runs/lib/carry-forward'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN, THREAD_GUTTER } from '@/components/ui/thread-column'
import { AwaitingBanner } from '@/features/collaboration/components/AwaitingBanner'
import { EngagementNotice } from '@/features/collaboration/components/EngagementNotice'
import { HandbackOffer } from '@/features/collaboration/components/HandbackOffer'
import { SpectatedTurn } from '@/features/collaboration/components/SpectatedTurn'
import {
  AnimatePresence,
  motion,
  motionInstant,
  motionSheetEnter,
  motionSheetExit,
} from '@/components/motion'
import { TOOLBAR_CLEAR_PADDING, TOOLBAR_CLEAR_SCROLL_MARGIN } from '../../lib/toolbar-clearance'
import { MessageRenderer } from '../chat-area/message-renderer'
import {
  UnreadDivider,
  TurnInFlightBanner,
  TypingIndicator,
  WelcomeState,
} from '../chat-area/chat-area-states'
import { turnEnding, NO_MESSAGES } from '../chat-area/chat-area-helpers'
import type { ChatAreaController } from './use-chat-area-controller'

export function ChatMessageList({ controller }: { controller: ChatAreaController }) {
  const handback = controller.handback
  const spectatedTurn = controller.spectatedTurn

  return (
    <>
      {!controller.showSkeleton && (
        <>
          {/* The greeting LEAVES rather than disappearing. Sending the first
                    message swaps this whole plane in one commit — greeting out,
                    transcript in, composer down to the floor — and the reader is
                    looking straight at the greeting when it happens, because it is
                    what sits above the input they just typed into.

                    `mode="popLayout"` is what makes the two overlap: the outgoing
                    greeting is lifted out of the flow, so the transcript takes the
                    plane immediately instead of waiting behind a fade. It drifts
                    DOWN as it goes, with the composer, rather than up and away from
                    it — the whole empty-canvas group descends and dissolves while
                    the conversation arrives above it.

                    The offset it is bottom-aligned against is frozen for exactly
                    this reason (see `useComposerMetrics`): every number under it
                    changes in the same tick. */}
          <AnimatePresence initial={false} mode="popLayout">
            {controller.isEmpty && (
              <motion.div
                key="welcome"
                className="flex flex-1 flex-col"
                initial={{ opacity: 0, y: 16 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: controller.prefersReducedMotion ? motionInstant : motionSheetEnter,
                }}
                exit={{ opacity: 0, y: 16 }}
                transition={controller.prefersReducedMotion ? motionInstant : motionSheetExit}
              >
                <WelcomeState
                  isAuthenticated={controller.isAuthenticated}
                  onSignIn={controller.onSignIn}
                  inProject={Boolean(controller.activeProjectId)}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {!controller.isEmpty && (
            <motion.div
              initial={controller.listArrivesFromSkeleton ? { opacity: 0 } : false}
              animate={{ opacity: 1, transition: controller.rowEnter }}
              className={cn(
                THREAD_COLUMN,
                THREAD_GUTTER,
                'flex flex-col gap-4',
                TOOLBAR_CLEAR_PADDING
              )}
              style={{ paddingBottom: 'calc(var(--composer-h, 11rem) + 1.5rem)' }}
            >
              {/* The observed list holds the messages and nothing else. The
                  anchor spacer below is its sibling: the observer refits the spacer,
                  and a spacer inside the observed box resized it again at the same
                  depth, a "ResizeObserver loop" error once per frame. */}
              <div ref={controller.contentRef} className="flex flex-col gap-4">
                {/* `presenceAffectsLayout={false}`: nothing in the list uses
                            layout animation, and with the default each row got a new
                            PresenceContext on every render, which re-rendered every
                            `motion.*` inside every earlier answer through context,
                            past MessageRenderer's memo: 920 fibers and 69 ms per delta
                            flush in a 40-message thread on a 4× throttled phone
                            (React performance audit, 2026-09). */}
                {/* Keyed by the conversation: a thread swap replaces the whole
                            presence, so the rows of the thread left are gone in the
                            same commit. Keyed per row only, they all played their exit
                            for 180 ms beside the new thread's rows. */}
                <AnimatePresence
                  key={controller.currentConversation?.id ?? 'draft'}
                  initial={false}
                  presenceAffectsLayout={false}
                >
                  {controller.displayableMessages.map((message) => {
                    const isUserMessage = message.messageType === 'user' || message.role === 'user'
                    const messageSteps = isUserMessage
                      ? controller.getStepsForUserMessage(message.id)
                      : []
                    const hasThinkingSteps = messageSteps.length > 0

                    const isCurrentlyStreaming =
                      isUserMessage &&
                      controller.turnLive &&
                      message.id === controller.currentUserMessageId
                    if (isCurrentlyStreaming) controller.liveShownIdsRef.current.add(message.id)
                    const showDerivation =
                      isUserMessage &&
                      (hasThinkingSteps || controller.liveShownIdsRef.current.has(message.id))

                    const turnMessages =
                      (isUserMessage && controller.threadLayout.turnOf.get(message.id)) ||
                      NO_MESSAGES

                    const shouldCheckPostState = isUserMessage && !isCurrentlyStreaming

                    const isWaiting =
                      shouldCheckPostState &&
                      turnMessages.some((m) => m.messageType === 'prompt' && !m.isPromptResponded)

                    const agentMsg = shouldCheckPostState
                      ? turnMessages.find(
                          (m) => m.messageType === 'assistant' || m.messageType === 'agent_response'
                        )
                      : undefined

                    const turnView = controller.turns?.[message.id]
                    const explainedByError = turnMessages.some(
                      (m) =>
                        m.messageType === 'error' &&
                        m.errorData?.errorCode !== 'agent.response_interrupted'
                    )
                    const hasResponse =
                      agentMsg !== undefined || turnMessages.some((m) => m.runLedger)
                    const failedHere =
                      Boolean(agentMsg?.failed) ||
                      turnView?.phase === 'failed' ||
                      controller.failedTurnIdsRef.current.has(message.id)
                    const isInterrupted =
                      shouldCheckPostState &&
                      !isWaiting &&
                      !hasResponse &&
                      turnView === undefined &&
                      !explainedByError &&
                      !failedHere
                    const isStopped =
                      shouldCheckPostState &&
                      (agentMsg?.stopped === true || turnView?.outcome === 'cancelled')
                    const endedAs = shouldCheckPostState
                      ? turnEnding(turnView, turnMessages, failedHere || explainedByError)
                      : undefined

                    const answering = isCurrentlyStreaming && controller.answerHasBegun

                    const answerSettled =
                      message.messageType === 'agent_response' &&
                      !message.isStreaming &&
                      controller.revealingId !== message.id
                    const fileNote =
                      answerSettled &&
                      offersFileNote({
                        kind: message.answerMeta?.kind,
                        projectId: controller.activeProjectId,
                        body: message.content,
                      })

                    if (message.id === controller.heldAnswerId) return null
                    controller.renderedIdsRef.current.add(message.id)

                    const isAnchorTarget = isUserMessage && message.id === controller.anchorId

                    const messageAuthorship = controller.authorship.get(message.id)

                    return (
                      <motion.div
                        key={controller.threadLayout.rowKeyOf.get(message.id) ?? message.id}
                        id={`message-${message.id}`}
                        data-chat-anchor={isAnchorTarget ? 'true' : undefined}
                        className={cn(
                          'flex flex-col gap-4',
                          TOOLBAR_CLEAR_SCROLL_MARGIN,
                          'ring-offset-background duration-quick rounded-surface ring-offset-4 transition-shadow ease-out motion-reduce:transition-none',
                          controller.highlightedMessageId === message.id && 'ring-warning/50 ring-2'
                        )}
                        custom={message.id}
                        variants={controller.rowVariants}
                        initial={controller.hydratedIds.has(message.id) ? false : 'hidden'}
                        animate="shown"
                        exit="leave"
                      >
                        {/* Where the reader left off, in a shared thread (spec CC-19). */}
                        {controller.unreadDividerBeforeId === message.id && (
                          <UnreadDivider
                            label={controller.tCollaboration('thread.unreadDivider')}
                          />
                        )}

                        {/* Render the message */}
                        <MessageRenderer
                          message={message}
                          conversationId={controller.currentConversation?.id}
                          projectId={controller.activeProjectId}
                          previousFindings={
                            message.runLedger
                              ? previousRunFindings(controller.messages ?? [], message.id)
                              : undefined
                          }
                          onCommissionFinding={
                            controller.commissionRun ? controller.commissionFromFinding : undefined
                          }
                          onContinueRun={
                            controller.commissionRun ? controller.continueRun : undefined
                          }
                          onErrorDismiss={controller.dismissErrorCard}
                          onErrorRetry={controller.handleErrorRetry}
                          showReasoning={controller.showReasoningSkills}
                          author={messageAuthorship?.author}
                          grouped={messageAuthorship?.grouped}
                          currentUserId={controller.currentUserId}
                          promptAddresseeName={
                            message.promptFor
                              ? (controller.authorOf(message.promptFor)?.name ?? null)
                              : null
                          }
                        />

                        {/* Assistant-side thread spine: the Herleitung shares the
                            answer card's width and left alignment, so the reasoning and
                            the answer stack as ONE left column (the user bubble stays
                            right-aligned). Shown from the send, open while the turn
                            works, folded to its one-line bar when the answer's first
                            words arrive; the bar stays live until the settle, which
                            then changes only its status. */}
                        {showDerivation && (
                          <div className="w-full">
                            <ChatThinking
                              steps={messageSteps}
                              isThinking={isCurrentlyStreaming}
                              autoOpen={isCurrentlyStreaming && hasThinkingSteps && !answering}
                              answering={answering}
                              since={message.timestamp}
                              answerDurationMs={agentMsg?.answerDurationMs}
                              isWaiting={isWaiting}
                              isInterrupted={isInterrupted}
                              isStopped={isStopped}
                              endedAs={endedAs}
                              isRecoveryPending={controller.isRecoveryPending}
                              enabledDataSources={message.enabledDataSources}
                              messageFiles={message.messageFiles}
                              userQuestion={message.content}
                              answerConfidence={agentMsg?.answerConfidence}
                              citations={agentMsg?.citations}
                              confidenceCheck={agentMsg?.confidenceCheck}
                              answerText={agentMsg?.content}
                              answerId={agentMsg?.id}
                              escalationReason={agentMsg?.escalationReason}
                              retrievalLedger={agentMsg?.retrievalLedger}
                            />
                          </div>
                        )}

                        {/* The questions this answer made askable, BELOW the
                            answer and outside its surface — the product owner's
                            ruling, and §6 of docs/architecture/post-answer-stages.md.
                            Same column, same edges, same full width as the answer and
                            the Herleitung; no new layout concept.

                            LAST in the message column on purpose. A stage delivers
                            this seconds after the answer, so it appears under a
                            reader who is already reading — and it may do that without
                            reserving space only because nothing sits below it to
                            move. The other half of that guarantee (nothing below it
                            in the THREAD either, the answer no longer streaming, the
                            reader not already typing) is enforced where the stage
                            arrives, in `lib/turn-projection.ts`. */}
                        {/* One more chip beside them, decided in the browser: the
                            offer to file this answer as an Aktenvermerk. It rides the
                            rail rather than getting a surface of its own, because it
                            is the same gesture the questions are (fill the composer,
                            the reader presses send) and a second block under the
                            answer would be a second thing to learn. Decided in the
                            answer's row once it has settled, so the chip cannot
                            appear mid-stream, and appears below the answer. */}
                        {(message.stages?.followUps || fileNote) && (
                          <FollowUpsRail
                            items={message.stages?.followUps?.items}
                            offerFileNote={fileNote}
                            animateIn={
                              !controller.hydratedIds.has(message.id) ||
                              (Boolean(message.stages?.followUps) &&
                                !controller.hydratedRailIdsRef.current.has(message.id))
                            }
                          />
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>

                {/* The routing rule for a message that tags nobody (ADR-0036).
                    In `mention` mode it states the rule where the question occurs —
                    "why didn't Piloti answer that?" — and offers the way back. In `ask`
                    mode, which is the default and stays the default, it is silent unless
                    the server suggests otherwise, and then it OFFERS rather than
                    announces: a thread must not rewire who answers next on its own.
                    Above the banner because this is the standing rule while the banner
                    is a transient state. */}
                {controller.shared && (
                  <EngagementNotice
                    mode={controller.engagement}
                    suggestion={controller.engagementSuggestion}
                    onChange={controller.setEngagement}
                    canChange={controller.myRole !== 'viewer'}
                  />
                )}

                {/* The thread is WAITING on a named person (spec MN-8). Without this
                    mounted, the agent's silence has no explanation on screen, and
                    "Ohne Antwort weitermachen" — the release that ADR-0034 names as the
                    mitigation for its own worst risk, a wait nobody ever answers — has no
                    affordance at all. The component existed, was tested and was
                    screenshotted for a while before anything rendered it; unit-green is
                    not reachable.

                    Mutually exclusive with the hand-back offer by construction: this
                    returns null once `pending` is empty, which is exactly when the offer
                    becomes eligible. */}
                {/* Entrance owned here, like a thread row's: only a wait that
                            begins while the thread is open arrives; one already
                            pending when it opens is simply there. */}
                <AnimatePresence initial={false}>
                  {controller.shared && controller.threadAwaitsHuman && (
                    <motion.div
                      key="awaiting"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: controller.rowEnter }}
                      exit={{ opacity: 0, transition: controller.rowLeave }}
                    >
                      <AwaitingBanner
                        awaiting={controller.awaiting}
                        onRelease={controller.release}
                        onAskAgent={controller.handleAskAgent}
                        onAskBack={controller.handleAskBack}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* The colleague has answered and Piloti is out of the loop — the one
                    moment the thread is worth handing on, and until now the only
                    transition with no affordance on screen (see HandbackOffer). Anchored
                    here, directly under the answer it is about. */}
                <AnimatePresence initial={false}>
                  {controller.showHandback && handback && (
                    <motion.div
                      key="handback"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: controller.rowEnter }}
                      exit={{ opacity: 0, transition: controller.rowLeave }}
                    >
                      <HandbackOffer
                        people={handback.people}
                        onAccept={controller.handleHandback}
                        onDismiss={() => controller.setHandbackDismissedFor(handback.anchorId)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Latency-gap typing indicator (before the first token arrives) */}
                {controller.showTypingPlaceholder && <TypingIndicator />}

                {/* The agent is working for SOMEONE in this thread (spec CC-13). Without
                    this an observer sees a thread where nothing appears to be happening
                    and a composer that will not take their question. Suppressed while
                    this client is itself streaming — the asker already has the typing
                    indicator and the Herleitung.

                    Two renderings of the same fact, and the LIVE one is preferred: when
                    the agent's frames are reaching this observer (ADR-0039) they watch
                    the answer being written, and the banner is what remains when they
                    are not — a gated org, no shared cache tier, a dropped stream, or the
                    first moments before the first token. `spectatingLive` is the switch,
                    and it only turns on once there is something to show, so the banner is
                    never replaced by an empty box. */}
                {controller.shared &&
                  controller.turnInFlight &&
                  !controller.isStreaming &&
                  !controller.showTypingPlaceholder &&
                  (controller.spectatingLive && spectatedTurn ? (
                    <SpectatedTurn
                      turn={spectatedTurn}
                      label={controller.turnInFlightLabel}
                      since={
                        controller.messages?.find((m) => m.id === spectatedTurn.turnId)?.timestamp
                      }
                    />
                  ) : (
                    <TurnInFlightBanner label={controller.turnInFlightLabel} />
                  ))}

                {/* A colleague writing while you are reading is a change you must be able
                    to learn about without eyes. Polite, so it never interrupts. Keyed on
                    the message id so a SECOND arrival from the same person is a fresh
                    node — identical text in a mutated region is not re-announced. */}
                <div
                  key={controller.lastArrival?.messageId ?? 'none'}
                  className="sr-only"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {controller.shared && controller.lastArrival
                    ? controller.tCollaboration('thread.authorAria', {
                        name:
                          controller.lastArrival.authorName ??
                          controller.authorOf(controller.lastArrival.authorUserId)?.name ??
                          controller.tCollaboration('inbox.unknownActor'),
                      })
                    : ''}
                </div>

                {/* This client's own turn ending, said once (`turnNote`). */}
                <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {controller.turnNote.text}
                </div>
              </div>

              {/* Top-anchor spacer: invisible, zero-height by default. While a
                  sent question is anchored to the top it holds exactly the room the
                  answer has not filled yet (`fitAnchorSpacer`), shrinking as the
                  answer grows. It is kept, fitted, when the stream ends; the next
                  question or a thread swap takes it. */}
              {/* `overflow-anchor: none`: the browser must never pick the
                  spacer as its scroll anchor. It is resized every frame of a live
                  answer, and an anchor on it scrolled the page to follow it. */}
              <div
                ref={controller.anchorSpacerRef}
                aria-hidden="true"
                style={{ minHeight: 0, overflowAnchor: 'none' }}
              />
            </motion.div>
          )}
        </>
      )}
    </>
  )
}
