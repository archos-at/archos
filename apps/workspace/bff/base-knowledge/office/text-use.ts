/**
 * Whether a copy's text may be used (ADR-0158, design §4.7). Pure.
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

export function textUseOf(licenceClass: LicenceClass, terms: KnowledgeTerms): TextUse {
  if (licenceClass !== 'licensed') return 'used'
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
