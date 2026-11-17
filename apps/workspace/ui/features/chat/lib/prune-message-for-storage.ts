import type { ChatMessage } from '../types'

const cap = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)

const MAX_CITATION_CONTENT = 300

const MAX_CITATION_SNIPPET = 1200

export const pruneMessageForStorage = (message: ChatMessage): ChatMessage => {
  if (!message.citations?.length) return message
  const citations = message.citations.map((c) => {
    const content = cap(c.content, MAX_CITATION_CONTENT)
    const snippet = c.snippet && cap(c.snippet, MAX_CITATION_SNIPPET)
    return content === c.content && snippet === c.snippet ? c : { ...c, content, snippet }
  })
  return { ...message, citations }
}
