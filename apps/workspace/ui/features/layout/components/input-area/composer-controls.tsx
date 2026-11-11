import { ArrowUp, FileText, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from '@/components/motion'
import { EffortDial } from '@/features/chat/components/effort-dial'
import { TemporaryChatToggle } from '@/features/chat/conversation-privacy'

import { DictationButton } from '@/features/dictation'
import { ComposerAttach } from '../ComposerAttach'
import { AddresseeIndicator } from '@/features/collaboration/components/AddresseeIndicator'
import type { InputAreaController } from './use-input-area-controller'

export function ComposerControls({ controller }: { controller: InputAreaController }) {
  return (
    <>
      {/* ONE row at every width: the mention offer at its start, the actions at its
          end (ticket #38, R2). It was a column below `sm`, so a phone stacked the
          actions and the offer on lines of their own and the composer grew by a
          row for a hint. The offer folds to its `@` where the card is narrow
          (`AddresseeIndicator`, against the card's `@container`); only a
          statement about who receives the message takes a line of its own. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* The hold, said out loud. Without it the message simply
                      vanishes from the composer and nothing arrives — which reads
                      as a dropped send, the one impression a held message must not
                      give. The way out is offered beside it: a reader who does not
                      want to wait for the file can ask now and get the answer they
                      would have got before this existed. */}
        <AnimatePresence initial={false}>
          {controller.heldForUpload !== null && (
            <motion.span
              key="held-for-upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: controller.holdEnter }}
              exit={{ opacity: 0, transition: controller.holdExit }}
              className="text-muted-foreground flex basis-full items-center gap-1.5 text-xs @lg:order-2 @lg:basis-auto"
              data-testid="composer-held-for-upload"
              role="status"
            >
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {controller.t('inputArea.heldForUpload')}
              <button data-attr="chat-send-held-now"
                type="button"
                onClick={controller.sendHeldNow}
                className="text-foreground touch-target font-medium underline-offset-2 hover:underline"
              >
                {controller.t('inputArea.heldForUploadSendNow')}
              </button>
            </motion.span>
          )}
        </AnimatePresence>

        <div className="contents">
          {/* Datenbasis — the one control for WHERE Piloti may look.
                  WITHHELD for now (product decision, 2026-08): the picker is
                  commented out rather than deleted so it can return. While it is
                  hidden, every turn goes out with the fetch default — every
                  available source enabled (`fetchDataSources`) — so nothing
                  narrows silently; only a conversation that saved a narrower
                  selection while the control existed still restores it.
                  To restore: uncomment this block and import `SourceBasisPicker`,
                  `SourceBasisTrigger` and `Popover`, `PopoverTrigger`,
                  `PopoverContent`.

                  The trigger names the mix (a preset, a set of strata, "Alle
                  Quellen"); it never renders a bare count, because the count it
                  used to render was wrong in both directions — see
                  components/source-basis. Open state is lifted so the trigger can
                  tell "the reader is watching the picker" from "a preset click
                  landed off-screen".

                  <Popover open={sourcesOpen} onOpenChange={setSourcesOpen}>
                    <PopoverTrigger asChild>
                      <SourceBasisTrigger disabled={cannotContribute} pickerOpen={sourcesOpen} />
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      className="w-88 max-w-[calc(100vw-2rem)] p-3"
                    >
                      <SourceBasisPicker />
                    </PopoverContent>
                  </Popover> */}

          {/* Right Actions: manage-files, effort, attach, dictation, send —
                  pushed right. Dictation sits beside Send, where the thumb ends up. */}
          <div className="order-3 ml-auto flex shrink-0 items-center gap-1">
            {/* Manage files — opens a Dialog hosting the full FileSourcesTab
                    (browse, upload zone, per-file delete). Replaces the old
                    right-panel toggle. Shown only when files exist. */}
            {controller.attachedFilesCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                // Redundant with the inline file chips (status + retry + remove)
                // on a narrow composer — hidden on mobile so the action row
                // stays one clean line; the FileSourcesTab dialog it opens
                // (browse + upload zone) remains available on wider viewports.
                // Mobile reaches the same dialog via the "manage" text entry
                // under the chip strip.
                className="text-muted-foreground hidden h-8 rounded-lg px-2.5 sm:inline-flex pointer-coarse:h-11"
                disabled={controller.cannotContribute || !controller.knowledgeLayerAvailable}
                onClick={() => controller.setManageFilesOpen(true)}
                aria-label={controller.t('inputArea.manageFilesCount', {
                  count: controller.attachedFilesCount,
                })}
                title={
                  controller.knowledgeLayerAvailable
                    ? controller.t('inputArea.manageFiles')
                    : controller.t('inputArea.uploadNotAvailable')
                }
              >
                <FileText className="size-3" aria-hidden="true" />
                <span className="text-xs font-medium">{controller.attachedFilesCount}</span>
              </Button>
            )}

            {/* Whether anything from this chat is kept (ADR-0180), beside the
                        other per-chat setting. Not for a HITL response: that
                        answers a prompt, it does not set up a chat. */}
            {!controller.isResponseMode && (
              <TemporaryChatToggle
                conversationId={controller.currentConversationId}
                disabled={controller.cannotContribute}
              />
            )}

            {/* How hard Piloti thinks, for this chat. A HITL response is
                        not a question, so the dial has nothing to say there. It is
                        hidden rather than unmounted: it keeps its box, so the
                        buttons to its right do not shift when a prompt arrives. */}
            {/* On a phone the chevron goes: the row is 294px wide. The
                          dial still opens. */}
            <EffortDial
              className="max-sm:px-1.5 max-sm:[&>svg]:hidden"
              conversationId={controller.currentConversationId}
              disabled={controller.cannotContribute}
              hidden={controller.isResponseMode}
              focusOnHide={controller.textareaRef}
            />

            {/* Attach: the file picker with a mouse; on a touch screen a menu
                        that opens the camera, the photo library or the documents. */}
            <ComposerAttach
              acceptedTypes={controller.fileUploadConfig.acceptedTypes}
              photos={controller.photos}
              disabled={
                controller.cannotContribute ||
                controller.isUploading ||
                controller.isBusy ||
                !controller.knowledgeLayerAvailable
              }
              title={
                controller.isBusy
                  ? controller.t('inputArea.uploadDisabledBusy')
                  : !controller.knowledgeLayerAvailable
                    ? controller.t('inputArea.uploadNotAvailable')
                    : controller.t('inputArea.selectFiles')
              }
              onFiles={(files, source) => void controller.handleFilesSelected(files, source)}
            />

            {/* Voice dictation, beside Send: the most used one-handed action
                        after sending, where the thumb already is. */}
            <DictationButton
              locale={controller.locale}
              disabled={controller.cannotContribute || controller.draftLocked}
              onTranscript={controller.handleTranscript}
              onError={controller.reportDictationError}
              onExplain={controller.explainDictation}
              channel={controller.dictationChannel}
            />

            {/* Send and Stop are ONE control whose glyph morphs. They used to be
                    two buttons swapped by a ternary, so the press target vanished
                    under the pointer the moment a turn started, keyboard focus was
                    dropped with it, and the loading state between them was the
                    literal text "...". Now the button stays put (Fitts: the
                    target the reader just hit is still there, and still focused),
                    only its job changes, and the glyph says which job: arrow to
                    send, square to stop. The square appears as soon as the turn
                    exists in the store, which is when the send is accepted, and the
                    arrow comes back the moment Stop is pressed, because
                    `stopStreaming` settles the turn locally rather than waiting for
                    the server's cancel. The spinner is only the residual case of a
                    turn loading with no stop to offer (a HITL answer in flight).
                    isResponseMode always shows send, so a HITL answer can be
                    submitted mid-turn. */}
            <Button
              size="icon"
              className={cn(
                // Ink, in both states. The armed button used to fill
                // with `accent-pop`, to mark readiness — but the
                // disabled/armed pair already reads as readiness
                // (the control goes from muted to solid and becomes
                // pressable), so the colour was carrying a distinction
                // the contrast had already made, in a hue this product
                // uses elsewhere to mean provenance.
                //
                // The press is the Button atom's CSS dip, taken to 0.96
                // because this is the screen's primary action. The atom
                // runs it on `--motion-snap` with an ease-out, which IS
                // `springPress` (ζ = 1, no overshoot, settled in ~126ms;
                // see button.tsx), and flattens it under reduced motion.
                // Not motion's `whileTap`: that injects tabindex="0", and
                // the old `motion.div` wrapper using it dipped to 0.94 ON
                // TOP of the atom's own dip, then had to undo the tab stop.
                //
                // `relative`: popLayout pops the leaving glyph out to
                // `position: absolute`, and it must stay centred in this
                // box while the new one arrives.
                'relative size-9 rounded-lg shadow-md active:scale-[0.96]'
              )}
              // `isStreaming` is the LOCAL store's turn flag and a viewer
              // never starts a local turn, so the stop gate is belt and
              // braces rather than a demonstrated hole — but cancelling
              // somebody else's turn is the most consequential thing on
              // this row, and it was the one control here with no gate.
              disabled={
                controller.showStop
                  ? controller.cannotContribute
                  : !controller.message.trim() || controller.disabled
              }
              onClick={controller.handleSendControlClick}
              onKeyDown={controller.handleSendControlKeyDown}
              aria-busy={!controller.showStop && controller.isLoading ? true : undefined}
              aria-label={
                controller.showStop
                  ? controller.t('inputArea.stopStreaming')
                  : controller.isResponseMode
                    ? controller.t('inputArea.sendResponse')
                    : controller.t('inputArea.sendMessage')
              }
              aria-keyshortcuts={controller.showStop ? 'Escape' : undefined}
              title={
                controller.showStop
                  ? controller.t('inputArea.stopStreamingTitle')
                  : controller.pendingCount > 0
                    ? controller.t('inputArea.sendWhilePending')
                    : controller.t('inputArea.sendQuery')
              }
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={controller.sendGlyph}
                  data-glyph={controller.sendGlyph}
                  className="inline-flex"
                  // An icon swap: ≤ 16px of scale travel, so springSnap's
                  // tick of overshoot lands inside the pixel budget. The
                  // opacity is a tween (opacity never springs), and the
                  // leaving glyph goes at once on motionQuickExit.
                  // Under reduced motion both are motionInstant: the
                  // glyph simply changes.
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1, transition: controller.glyphEnter }}
                  exit={{ opacity: 0, scale: 0.6, transition: controller.glyphExit }}
                >
                  {controller.sendGlyph === 'stop' ? (
                    <Square className="size-3.5 fill-current" aria-hidden="true" />
                  ) : controller.sendGlyph === 'sending' ? (
                    <Spinner size="xs" aria-hidden="true" />
                  ) : (
                    <ArrowUp className="size-4" aria-hidden="true" />
                  )}
                </motion.span>
              </AnimatePresence>
            </Button>
          </div>
        </div>

        {/* Who this message goes to — ALWAYS, whenever collaboration exists at
                  all. The point of it being unconditional: if it only appeared in the
                  unusual case, "Piloti is next" would remain something the user has to
                  infer from an absence. Borderless on purpose — it is a statement
                  standing among buttons, and must not read as one. */}
        {controller.canCollaborate && (
          <AddresseeIndicator
            mentions={controller.activeMentions}
            awaitingHuman={controller.threadAwaitsHuman}
            // Only where there is somebody to mention: a solo thread grows no
            // collaboration furniture (spec NF-8).
            // Offered wherever collaboration is available — including a PRIVATE
            // thread, because mentioning somebody is how a thread starts being
            // shared (the picker offers "Wird eingeladen"). This is the discovery
            // path into the feature, not a reward for already having used it.
            //
            // But NOT to someone who may not write here. A screenshot of the
            // read-only composer caught this: the whole control row was dimmed
            // and this one link sat above "Sie können hier mitlesen", live and
            // underlined, offering to type an `@` into a disabled textarea.
            // Same class as the paperclip and the Datengrundlage popover.
            onMentionSomeone={
              controller.cannotContribute ? undefined : controller.handleMentionSomeone
            }
          />
        )}
      </div>
    </>
  )
}
