/**
 * The closed vocabularies of the base knowledge records (migration 0200,
 * ADR-0158), each the value list of a CHECK. Pure, so the UI reads them too.
 */

export const KNOWLEDGE_RECORD_TYPES = ['work', 'edition', 'manifestation'] as const
export type KnowledgeRecordType = (typeof KNOWLEDGE_RECORD_TYPES)[number]

/** The kinds an office can hold today (design §3.5); the platform widens the CHECK later. */
export const KNOWLEDGE_WORK_KINDS = [
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
  'statute',
] as const
export type KnowledgeWorkKind = (typeof KNOWLEDGE_WORK_KINDS)[number]

/** The licence classes the licensed seam keys on (design §3.4). */
export const LICENCE_CLASSES = ['public_open', 'public_restricted', 'licensed'] as const
export type LicenceClass = (typeof LICENCE_CLASSES)[number]

export const KNOWLEDGE_CHECK_RESULTS = ['current', 'newer_known', 'withdrawn', 'source_unreachable'] as const
export type KnowledgeCheckResult = (typeof KNOWLEDGE_CHECK_RESULTS)[number]
