import 'server-only'
import { maskChatText } from '@/lib/upload-screening/service'
import {
  MAX_EVIDENCE_QUOTE_LENGTH,
  type DocumentEvidence,
} from '@/lib/project-profile/evidence-schema'

export interface RawDocumentEvidence {
  fileName: string
  page: number | null
  quote: string
}

export interface EvidencePolicy {
  organizationId: string
}

export async function documentEvidence(
  raw: RawDocumentEvidence,
  policy: EvidencePolicy
): Promise<DocumentEvidence> {
  const masked = (await maskChatText(policy.organizationId, raw.quote)).text.trim()
  return {
    kind: 'document',
    fileName: raw.fileName,
    page: raw.page,
    quote:
      masked.length > MAX_EVIDENCE_QUOTE_LENGTH
        ? `${masked.slice(0, MAX_EVIDENCE_QUOTE_LENGTH - 1)}…`
        : masked,
  }
}

export function reasonFromEvidence(
  evidence: Pick<DocumentEvidence, 'fileName' | 'page' | 'quote'>
): string {
  const where = evidence.page ? `${evidence.fileName}, S. ${evidence.page}` : evidence.fileName
  return `${where}: „${evidence.quote}"`
}
