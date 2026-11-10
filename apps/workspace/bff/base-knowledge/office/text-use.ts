/**
 * Whether a copy's text may be used (ADR-0163, design §4.7). Pure.
 *
 * An office licence for office-wide use does not by itself allow AI
 * processing. A licensed copy's text enters the index, a model's read or a
 * quotation only once the office has stated that its licence covers
 * processing by the hosted AI services; until then the copy is metadata-only
 * (kind, edition, designation, validity), and answers say the office holds the
 * norm but its text is not used. Public copies need no statement.
 */

import type { KnowledgeTerms, LicenceClass } from '@/lib/db/schema/knowledge-records'

export type TextUse = 'used' | 'metadata_only'

/** What each licence class needs before its text is used: nothing, or the office's statement on AI processing. */
const NEEDS_AI_STATEMENT: Readonly<Record<LicenceClass, boolean>> = {
  public_open: false,
  public_restricted: false,
  licensed: true,
}

export function textUseOf(licenceClass: LicenceClass, terms: KnowledgeTerms): TextUse {
  if (!NEEDS_AI_STATEMENT[licenceClass]) return 'used'
  return terms.aiProcessingAttestedAt ? 'used' : 'metadata_only'
}

/** The statements a confirmation or an edit makes, over the ones the copy already carries. */
export interface Attestations {
  licenceAttested?: boolean
  aiProcessingAttested?: boolean
}

/**
 * The copy's terms after a person's write: each statement given true is
 * recorded with who and when; `aiProcessingAttested: false` withdraws that one
 * (the copy goes back to metadata-only); anything not given is kept.
 */
export function termsAfter(
  previous: KnowledgeTerms,
  given: Attestations,
  userId: string,
  now: Date
): KnowledgeTerms {
  const at = now.toISOString()
  const terms: KnowledgeTerms = { ...previous }
  if (given.licenceAttested === true) Object.assign(terms, { attestedBy: userId, attestedAt: at })
  if (given.aiProcessingAttested === true)
    Object.assign(terms, { aiProcessingAttestedBy: userId, aiProcessingAttestedAt: at })
  if (given.aiProcessingAttested === false) {
    delete terms.aiProcessingAttestedBy
    delete terms.aiProcessingAttestedAt
  }
  return terms
}

/** The quote cap when the office's terms name none: the licensed seam's own default (ADR-0159). */
export const DEFAULT_QUOTE_MAX_CHARS = 500

/**
 * What a copy's search-index points and ingest job carry for the licensed seam
 * (ADR-0159), as the seam reads them: the class, whether the office stated its
 * licence covers AI processing, and the longest quote a model may see.
 */
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
    quoteMaxChars:
      typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_QUOTE_MAX_CHARS,
  }
}

/** The mark in the payload's own spelling (`licence_class`, `ai_processing_attested`, `quote_max_chars`). */
export function licenceMarkFields(mark: LicenceMark): {
  licence_class: LicenceClass
  ai_processing_attested: boolean
  quote_max_chars: number
} {
  return {
    licence_class: mark.licenceClass,
    ai_processing_attested: mark.aiProcessingAttested,
    quote_max_chars: mark.quoteMaxChars,
  }
}
