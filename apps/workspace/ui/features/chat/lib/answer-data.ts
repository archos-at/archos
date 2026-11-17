import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import type { SearchedSource } from '@/shared/components/MarkdownRenderer/answer-block-context'

export function searchedSources(ledger: RetrievalLedger | undefined): SearchedSource[] {
  const seen = new Map<string, SearchedSource>()
  for (const round of ledger ?? []) {
    for (const doc of round.docs) {
      const key = doc.name.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.set(key, { title: doc.title ?? doc.name, ...(doc.detail ? { detail: doc.detail } : {}) })
    }
  }
  return [...seen.values()]
}

const NOT_REGULATED = /\b(?:nicht|kaum|teilweise)\s+geregelt\b|\bkeine\s+regelung\b|\bnot\s+regulated\b|\bno\s+rule\b/i

export function isNotRegulated(answerMeta: AnswerMeta | undefined): boolean | undefined {
  if (!answerMeta) return undefined
  const words = [answerMeta.verdict?.value, answerMeta.topic].filter(Boolean).join(' ')
  return NOT_REGULATED.test(words)
}
