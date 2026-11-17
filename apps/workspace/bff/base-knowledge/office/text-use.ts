import type { KnowledgeTerms, LicenceClass } from '@/lib/db/schema/knowledge-records'

export type TextUse = 'used' | 'metadata_only'

const NEEDS_AI_STATEMENT: Readonly<Record<LicenceClass, boolean>> = {
  public_open: false,
  public_restricted: false,
  licensed: true,
}

export function textUseOf(licenceClass: LicenceClass, terms: KnowledgeTerms): TextUse {
  if (!NEEDS_AI_STATEMENT[licenceClass]) return 'used'
  return terms.aiProcessingAttestedAt ? 'used' : 'metadata_only'
}

export interface Attestations {
  licenceAttested?: boolean
  aiProcessingAttested?: boolean
}

export function termsAfter(previous: KnowledgeTerms, given: Attestations, userId: string, now: Date): KnowledgeTerms {
  const at = now.toISOString()
  const terms: KnowledgeTerms = { ...previous }
  if (given.licenceAttested === true) Object.assign(terms, { attestedBy: userId, attestedAt: at })
  if (given.aiProcessingAttested === true) Object.assign(terms, { aiProcessingAttestedBy: userId, aiProcessingAttestedAt: at })
  if (given.aiProcessingAttested === false) {
    delete terms.aiProcessingAttestedBy
    delete terms.aiProcessingAttestedAt
  }
  return terms
}

export const DEFAULT_QUOTE_MAX_CHARS = 500

export interface LicenceMark {
  licenceClass: LicenceClass
  aiProcessingAttested: boolean
  quoteMaxChars: number
}

export function licenceMarkOf(licenceClass: LicenceClass, terms: KnowledgeTerms): LicenceMark {
  const cap = terms.quoteMaxChars
  return {
    licenceClass,
    aiProcessingAttested: Boolean(terms.aiProcessingAttestedAt),
    quoteMaxChars: typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_QUOTE_MAX_CHARS,
  }
}

export function licenceMarkFields(mark: LicenceMark): { licence_class: LicenceClass; ai_processing_attested: boolean; quote_max_chars: number } {
  return { licence_class: mark.licenceClass, ai_processing_attested: mark.aiProcessingAttested, quote_max_chars: mark.quoteMaxChars }
}
