import type { TurnView } from '@/lib/turns/turn-fold'
import type { ComposerPrefill } from '../types'
import type { ChatSendFn, MessagesStateCreator } from './messages-slice-types'
import { createTurnActions } from './turn-actions'
import { createConversationActions } from './conversation-actions'
import { createComposerActions } from './composer-actions'

export type { ChatSendFn, MessagesSlice } from './messages-slice-types'
export { registerStopStreamingHandler } from './turn-actions'
export { mergeRemoteMessages } from '../lib/remote-message-merge'
export { runningTurnIn, turnStateFor } from '../lib/turn-selectors'

export const initialMessagesState = {
  isStreaming: false,
  isLoading: false,
  currentUserMessageId: null as string | null,
  currentTurnStartedAt: null as number | null,
  turns: {} as Record<string, TurnView>,
  projectId: null as string | null,
  composerPrefill: null as ComposerPrefill | null,
  composerSubject: null,
  composerDrafts: {} as Record<string, string>,
  chatSendFn: null as ChatSendFn | null,
}

export const createMessagesSlice: MessagesStateCreator = (set, get) => ({
  ...initialMessagesState,
  ...createTurnActions(set, get),
  ...createConversationActions(set, get),
  ...createComposerActions(set, get),
})
