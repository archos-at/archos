import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)

export const EXPERIENCE_MAX_DECISIONS = 12
export const EXPERIENCE_DECISION_MAX_CHARS = 600
export const EXPERIENCE_KNOWN_DECISIONS_MAX = 60
export const EXPERIENCE_KNOWN_DECISION_MAX_CHARS = 300
export const EXPERIENCE_QUOTE_MAX_CHARS = 300

export const EXPERIENCE_ERRORS = ['no_documents', 'no_model', 'extraction_failed'] as const
export const EXPERIENCE_DECISION_KINDS = ['decision', 'constraint'] as const
export const EXPERIENCE_OUTCOMES = ['accepted', 'condition', 'rejected', 'unknown'] as const

export const experienceVocabularyEntrySchema = z.object({
  multiple: z.boolean(),
  options: z.array(z.object({ token: text(100), label: text(200) })),
})

export const experienceVocabularySchema = z.object({
  federal_state: experienceVocabularyEntrySchema,
  building_class: experienceVocabularyEntrySchema,
  construction_method: experienceVocabularyEntrySchema,
  uses: experienceVocabularyEntrySchema,
  work_type: experienceVocabularyEntrySchema,
  oib_edition: experienceVocabularyEntrySchema,
})

export const experienceRequestSchema = z.object({
  organizationId: text(200),
  projectId: z.guid(),
  collection: text(300),
  fileNames: z.array(text(512)).min(1),
  vocabulary: experienceVocabularySchema,
  knownFacts: z.array(text(100)),
  knownDecisions: z.array(text(EXPERIENCE_KNOWN_DECISION_MAX_CHARS)).max(EXPERIENCE_KNOWN_DECISIONS_MAX),
})

export const experienceEvidenceSchema = z.object({
  fileName: text(512),
  page: z.string().trim().max(20),
  quote: text(EXPERIENCE_QUOTE_MAX_CHARS),
})

export const experienceFingerprintSchema = z.object({
  key: text(50),
  value: z.union([text(100), z.array(text(100)).min(1)]),
  evidence: z.array(experienceEvidenceSchema),
})

export const experienceDecisionSchema = z.object({
  kind: z.enum(EXPERIENCE_DECISION_KINDS),
  content: text(EXPERIENCE_DECISION_MAX_CHARS),
  outcome: z.preprocess((value) => (value === 'auflage' ? 'condition' : value), z.enum(EXPERIENCE_OUTCOMES)),
  evidence: z.array(experienceEvidenceSchema),
})

export const experienceResponseSchema = z.object({
  model: z.string().max(200),
  documentsRead: z.array(text(512)),
  fingerprint: z.array(experienceFingerprintSchema),
  decisions: z.array(experienceDecisionSchema).max(EXPERIENCE_MAX_DECISIONS),
  error: z.enum(EXPERIENCE_ERRORS).nullable(),
})

export type ExperienceVocabulary = z.infer<typeof experienceVocabularySchema>
export type ExperienceVocabularyEntry = z.infer<typeof experienceVocabularyEntrySchema>
export type ExperienceVocabularyKey = keyof ExperienceVocabulary
export type ExperienceRequest = z.infer<typeof experienceRequestSchema>
export type ExperienceEvidence = z.infer<typeof experienceEvidenceSchema>
export type ExperienceFingerprintItem = z.infer<typeof experienceFingerprintSchema>
export type ExperienceDecision = z.infer<typeof experienceDecisionSchema>
export type ExperienceResponse = z.infer<typeof experienceResponseSchema>

export type ProjectExperienceError = (typeof EXPERIENCE_ERRORS)[number] | 'backend_unavailable'

export interface ProjectExperienceResult {
  suggested: number
  drafted: number
  documentsRead: string[]
  error: ProjectExperienceError | null
}
