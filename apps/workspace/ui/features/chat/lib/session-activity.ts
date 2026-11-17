import { isLiveStatus, runDisplayStatus } from '@/lib/runs/run-vocabulary'
import type { ChatMessage } from '../types'

export const hasNoUserChatMessages = (messages: ChatMessage[]): boolean =>
  !messages.some((message) => message.messageType === 'user')

const isLiveRunMessage = (message: ChatMessage): boolean =>
  Boolean(message.runLedger && isLiveStatus(runDisplayStatus(message.runLedger)))

export const liveRunMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.filter(isLiveRunMessage)

export const hasLiveRun = (messages: ChatMessage[]): boolean => messages.some(isLiveRunMessage)

export const hasFinishedRun = (messages: ChatMessage[]): boolean =>
  messages.some((message) => message.runLedger && runDisplayStatus(message.runLedger) === 'done')
