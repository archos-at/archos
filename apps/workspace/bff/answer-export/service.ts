import 'server-only'
import { NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Message } from '@/lib/db/schema/messages'
import { findConversationInOrg, listMessagesForConversation } from '@/lib/conversations/repository'
import { findProjectInOrg } from '@/lib/projects/repository'
import { requireResourceAccess } from '@/lib/sharing/access'
import { getLocale, getTranslations } from '@/i18n/server'
import { answerExportCopy } from '@/i18n/namespaces/answer-export'
import { stripCardMarkers } from '@/lib/text/card-markers'
import { buildAnswerDocument, EXPORTED_CAPPED_REASONS, type AnswerConfidence } from './answer-document'
import { DOCX_MEDIA_TYPE, renderDocx } from './docx'
import type { AiProvenance } from '@/lib/ai-provenance'
import { sanitizeQuoteStamps } from '@/lib/conversations/message-quote-stamps'

export interface ExportedAnswer {
  filename: string
  bytes: Uint8Array
  mediaType: string
}

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high'])
const CAPPED_REASONS = new Set<string>(EXPORTED_CAPPED_REASONS)

function readQuoteStamps(metadata: Record<string, unknown>) {
  const provenance = metadata.provenance
  const stored =
    typeof provenance === 'object' && provenance !== null && !Array.isArray(provenance)
      ? sanitizeQuoteStamps((provenance as Record<string, unknown>).quoteStamps)
      : null
  return stored ?? sanitizeQuoteStamps(metadata.quote_stamps) ?? []
}

function readConfidence(metadata: Record<string, unknown>): AnswerConfidence | null {
  const provenance = metadata.provenance
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance))
    return null
  const record = provenance as Record<string, unknown>
  const level = record.answerConfidence
  if (typeof level !== 'string' || !CONFIDENCE_LEVELS.has(level)) return null

  const reason = record.answerConfidenceReason
  const capped = record.answerConfidenceCappedReason
  return {
    level: level as AnswerConfidence['level'],
    ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {}),
    ...(typeof capped === 'string' && CAPPED_REASONS.has(capped)
      ? { cappedReason: capped as AnswerConfidence['cappedReason'] }
      : {}),
  }
}

function questionFor(history: Message[], answerIndex: number): string | null {
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message.role === 'user' && message.content.trim()) return message.content.trim()
  }
  return null
}

function fileNameFor(stem: string, createdAt: Date): string {
  const day = createdAt.toISOString().slice(0, 10)
  const slug = stem
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
  return `${slug || 'answer'}-${day}.docx`
}

function answerProvenance(metadata: Record<string, unknown>): AiProvenance {
  const traceId = metadata.trace_id
  return typeof traceId === 'string' && traceId ? { runId: traceId } : {}
}

export async function exportAnswerDocument(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string
): Promise<ExportedAnswer> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const [conversation, history] = await Promise.all([
    findConversationInOrg(conversationId, session.organizationId),
    listMessagesForConversation(conversationId),
  ])
  if (!conversation) throw new NotFoundError()

  const index = history.findIndex((message) => message.id === messageId)
  if (index === -1) throw new NotFoundError()
  const answer = history[index]

  if (answer.role !== 'assistant') {
    throw new UnprocessableError('Only an assistant answer can be exported as a document')
  }

  const metadata = (answer.metadata ?? {}) as Record<string, unknown>

  const project = conversation.projectId
    ? await findProjectInOrg(conversation.projectId, session.organizationId)
    : null

  const [t, locale] = await Promise.all([getTranslations(answerExportCopy), getLocale()])

  const blocks = buildAnswerDocument(
    {
      conversationTitle: conversation.title,
      projectName: project?.name ?? null,
      question: questionFor(history, index),
      answer: stripCardMarkers(answer.content),
      createdAt: new Date(answer.createdAt),
      citations: metadata.citations,
      cards: metadata.cards,
      findings: metadata.findings,
      quoteStamps: readQuoteStamps(metadata),
      confidence: readConfidence(metadata),
    },
    t,
    locale
  )

  return {
    filename: fileNameFor(conversation.title?.trim() || t('fileName'), new Date(answer.createdAt)),
    bytes: renderDocx(blocks, { aiProvenance: answerProvenance(metadata) }),
    mediaType: DOCX_MEDIA_TYPE,
  }
}
