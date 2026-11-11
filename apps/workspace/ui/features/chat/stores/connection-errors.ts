/**
 * At most one live connection error per conversation.
 *
 * `connection.failed` and `connection.lost` say one thing about this page: its
 * socket is not reaching a server. They are not drawn as cards; the status
 * dock reads them as one line („Verbindung unterbrochen“), and they leave the
 * thread when a socket opens again (`dismissConnectionErrors`) or the reader
 * dismisses one. Until then the error is unresolved, and a second one adds
 * nothing a person can read: it only left a second row for every later reader
 * of the messages to pass over, and one more for a dismissal by id to miss.
 *
 * Other error kinds are separate events and each keeps its own card.
 */

import type { ChatMessage } from '../types'

const isLiveConnectionError = (message: ChatMessage): boolean =>
  message.messageType === 'error' &&
  (message.errorData?.errorCode === 'connection.failed' || message.errorData?.errorCode === 'connection.lost')

/**
 * `messages` with `error` added. A connection error takes the place of the
 * thread's last unresolved one, which is any still among the messages: both
 * ways of resolving one remove it.
 */
export const withErrorMessage = (messages: readonly ChatMessage[], error: ChatMessage): ChatMessage[] => {
  const live = isLiveConnectionError(error) ? messages.findLastIndex(isLiveConnectionError) : -1
  if (live === -1) return [...messages, error]
  return messages.map((message, index) => (index === live ? error : message))
}
