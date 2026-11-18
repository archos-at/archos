import type { StateCreator } from 'zustand'
import type { ChatStore, Conversation, RecoveryOutcome } from '../types'
import type { SessionsSlice } from './sessions-store'
import { mapServerMessagesToChatMessages } from '../lib/server-message-mapper'
import { updateConversationInList } from '../lib/conversation-updates'
import { getConversationsClient } from '../lib/conversations-client-access'
import { runningTurnIn } from '../lib/turn-selectors'

const TURN_SILENCE_MS = 70_000
const AWAIT_ANSWER_POLL_MS = 4_000
const AWAIT_ANSWER_BLIND_MS = 120_000
const AWAIT_ANSWER_CEILING_MS = 40 * 60_000

const serverAnswerWaits = new Map<string, Promise<RecoveryOutcome>>()

let recoveryHolds = 0

export const createAnswerRecoverySlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | '_awaitServerAnswer'
    | '_recoverInterruptedAssistantMessage'
  >
> = (set, get) => ({
  _awaitServerAnswer: (conversationId: string, afterUserMessageId: string): Promise<RecoveryOutcome> => {
    if (serverAnswerWaits.has(conversationId)) return Promise.resolve('superseded')
    const wait = (async (): Promise<RecoveryOutcome> => {
      recoveryHolds += 1
      set({ isRecoveryPending: true }, false, 'awaitServerAnswer:start')
      try {
        const conversationsClient = await getConversationsClient()
        const started = Date.now()
        for (;;) {
          const outcome = await get()._recoverInterruptedAssistantMessage(
            conversationId,
            afterUserMessageId,
            { quiet: true }
          )
          if (outcome !== 'nothing') return outcome
          const elapsed = Date.now() - started
          if (elapsed >= AWAIT_ANSWER_CEILING_MS) return 'nothing'
          const age = await conversationsClient.newestFrameAge(conversationId)
          const alive =
            age === undefined ? elapsed < AWAIT_ANSWER_BLIND_MS : age !== null && age < TURN_SILENCE_MS
          if (!alive) {
            return get()._recoverInterruptedAssistantMessage(conversationId, afterUserMessageId, {
              quiet: true,
            })
          }
          await new Promise((resolve) => setTimeout(resolve, AWAIT_ANSWER_POLL_MS))
        }
      } finally {
        recoveryHolds -= 1
        if (recoveryHolds === 0) set({ isRecoveryPending: false }, false, 'awaitServerAnswer:end')
      }
    })().finally(() => {
      serverAnswerWaits.delete(conversationId)
    })
    serverAnswerWaits.set(conversationId, wait)
    return wait
  },

  _recoverInterruptedAssistantMessage: async (
    conversationId: string,
    afterUserMessageId: string,
    { quiet = false }: { quiet?: boolean } = {}
  ): Promise<RecoveryOutcome> => {
    if (!quiet) {
      recoveryHolds += 1
      set({ isRecoveryPending: true }, false, 'recoveryPending:start')
    }
    try {
      const conversationsClient = await getConversationsClient()
      const serverMessages = await conversationsClient.listMessages(conversationId)
      const mapped = mapServerMessagesToChatMessages(serverMessages)

      const { conversations, currentConversation, turns } = get()
      const target = conversations.find((c) => c.id === conversationId)
      if (!target || runningTurnIn(turns, conversationId)) return 'superseded'

      const localIds = new Set(target.messages.map((m) => m.id))

      const userIdx = mapped.findIndex((m) => m.id === afterUserMessageId)
      const searchSpace = userIdx >= 0 ? mapped.slice(userIdx + 1) : mapped
      const answers = searchSpace.filter((m) => m.role === 'assistant')
      const recovered = answers.find((m) => !localIds.has(m.id))
      if (!recovered) return answers.length > 0 ? 'superseded' : 'nothing'

      const merged: Conversation = {
        ...target,
        messages: [...target.messages, recovered],
      }
      set(
        {
          conversations: updateConversationInList(conversations, merged),
          ...(currentConversation?.id === conversationId && { currentConversation: merged }),
        },
        false,
        'recoverInterruptedAssistantMessage'
      )
      return 'recovered'
    } catch (err) {
      console.warn('[recoverInterruptedAssistantMessage] Failed:', err)
      return 'nothing'
    } finally {
      if (!quiet) {
        recoveryHolds -= 1
        if (recoveryHolds === 0) set({ isRecoveryPending: false }, false, 'recoveryPending:end')
      }
    }
  },
})
