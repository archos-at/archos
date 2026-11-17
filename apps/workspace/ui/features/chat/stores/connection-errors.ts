import type { ChatMessage } from '../types'

const isLiveConnectionError = (message: ChatMessage): boolean =>
  message.messageType === 'error' &&
  (message.errorData?.errorCode === 'connection.failed' || message.errorData?.errorCode === 'connection.lost')

export const withErrorMessage = (messages: readonly ChatMessage[], error: ChatMessage): ChatMessage[] => {
  const live = isLiveConnectionError(error) ? messages.findLastIndex(isLiveConnectionError) : -1
  if (live === -1) return [...messages, error]
  return messages.map((message, index) => (index === live ? error : message))
}
