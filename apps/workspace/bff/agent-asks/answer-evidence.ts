import { buildCitationModel } from '@/features/chat/lib/citations/build'
import { CITATION_PARAM, encodeCitationLink } from '@/features/chat/lib/citations/deep-link'
import { citedLoci, isHttpUrl, refHost } from '@/features/chat/lib/citations/model'
import { decodeCitations } from '@/features/chat/lib/citations/persistence'
import { describeResource } from '@/lib/sharing/registry'
import { sanitizeProvenance } from '@/lib/conversations/message-provenance'
import { type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'
import { sourceLine } from '@/shared/citation-style'
import type { AskAnswerEvidence } from './ask-wire'

interface EvidenceMessage {
  metadata: unknown
  createdAt: Date | string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function threadPath(conversationId: string, projectId: string | null, origin: string | null): string {
  const path = describeResource('conversation').deepLink(conversationId, { projectId: projectId ?? undefined })
  return origin ? `${origin}${path}` : path
}

function sourcesOf(
  message: EvidenceMessage,
  thread: { conversationId: string; projectId: string | null; origin: string | null; styles: CitationStylePayload },
): NonNullable<AskAnswerEvidence['sources']> {
  const metadata = isRecord(message.metadata) ? message.metadata : {}
  const answeredAt = new Date(message.createdAt)
  const citations = decodeCitations(metadata.citations, answeredAt)
  if (!citations) return []
  const base = threadPath(thread.conversationId, thread.projectId, thread.origin)
  const sources: NonNullable<AskAnswerEvidence['sources']> = []
  for (const document of buildCitationModel({ citations })) {
    const loci = citedLoci(document)
    if (loci.length === 0) continue
    const outbound = document.url && isHttpUrl(document.url) ? document.url : null
    const pages = new Set<number | undefined>()
    for (const locus of loci) {
      if (pages.has(locus.page)) continue
      pages.add(locus.page)
      sources.push({
        documentId: document.id,
        name: document.title,
        ...(locus.page !== undefined && { page: locus.page }),
        ...(locus.clause !== undefined && { clause: locus.clause }),
        kind: document.kind,
        url: outbound ?? `${base}&${CITATION_PARAM}=${encodeCitationLink({ document, locus })}`,
        citation: sourceLine({ ...document, host: refHost({ document }), locus: locus.clause, page: locus.page }, answeredAt, thread.styles),
      })
    }
  }
  return sources
}

function confidenceOf(message: EvidenceMessage): AskAnswerEvidence['confidence'] {
  const metadata = isRecord(message.metadata) ? message.metadata : {}
  const provenance = sanitizeProvenance(metadata.provenance)
  if (!provenance?.answerConfidence) return undefined
  return {
    level: provenance.answerConfidence,
    ...(provenance.answerConfidenceReason && { reason: provenance.answerConfidenceReason }),
    ...(provenance.answerConfidenceCappedReason && { cappedReason: provenance.answerConfidenceCappedReason }),
    ...(provenance.lookupFoundNothing && { lookupFoundNothing: true as const }),
  }
}

export function answerEvidence(
  message: EvidenceMessage,
  thread: { conversationId: string; projectId: string | null; origin?: string | null; styles?: CitationStylePayload },
): AskAnswerEvidence {
  const styles = thread.styles ?? FALLBACK_CITATION_STYLES
  const sources = sourcesOf(message, { ...thread, origin: thread.origin ?? null, styles })
  const confidence = confidenceOf(message)
  return { ...(sources.length > 0 && { sources }), ...(confidence && { confidence }) }
}
