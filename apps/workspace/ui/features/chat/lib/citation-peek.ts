import type { ChatMessage } from '../types'
import {
  buildCitationModel,
  isCited,
  splitAnswerBody,
  type CitedDocument,
} from './citations'

export interface PeekableCitedFile {
  fileName: string
  source: 'project' | 'office'
  title: string
}

const PEEKABLE_KINDS = new Set<CitedDocument['kind']>(['project', 'office'])

export const peekableCitedFile = (docs: CitedDocument[]): PeekableCitedFile | null => {
  const files = docs.filter((doc) => PEEKABLE_KINDS.has(doc.kind) && isCited(doc))
  if (files.length !== 1) return null
  const doc = files[0]!
  const fileName = doc.fileName?.trim()
  if (!fileName) return null
  if (doc.kind !== 'project' && doc.kind !== 'office') return null
  return { fileName, source: doc.kind, title: doc.title }
}

export const latestFinishedAssistantMessage = (
  messages: readonly ChatMessage[] | undefined,
): ChatMessage | null => {
  if (!messages?.length) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (!isAssistantAnswer(message)) continue
    if (message.isStreaming) return null
    return message
  }
  return null
}

export const peekableFileForMessage = (message: ChatMessage): PeekableCitedFile | null => {
  const { entries } = splitAnswerBody(message.content ?? '')
  return peekableCitedFile(
    buildCitationModel({
      citations: message.citations,
      entries,
    }),
  )
}

const isAssistantAnswer = (message: ChatMessage): boolean =>
  message.messageType === 'agent_response' ||
  (message.role === 'assistant' && (message.messageType === undefined || message.messageType === 'assistant'))
