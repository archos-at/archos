import { z } from 'zod'
import { OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'

export const REFERENCE_PLACEMENTS = ['moved', 'edition', 'duplicate'] as const
export type ReferencePlacement = (typeof REFERENCE_PLACEMENTS)[number]

export const NORM_DESTINATIONS = ['office_shelf', 'suggest', 'project'] as const
export type NormDestination = (typeof NORM_DESTINATIONS)[number]

export const MAX_PLACED_NORMS = 8

export const projectNormsParamsSchema = z.object({
  id: z.guid().describe('From project-list.'),
})

export const NORM_REFERENCE_PAGE = 50
export const MAX_NORM_REFERENCE_PAGE = 200

export const listProjectNormsQuerySchema = z.object({
  folderId: z.guid().optional().describe('Omit for the top level.'),
  limit: z.coerce.number().int().min(1).max(MAX_NORM_REFERENCE_PAGE).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
})
export type ListProjectNormsQuery = z.infer<typeof listProjectNormsQuerySchema>

const entryValuesSchema = z
  .object({
    kind: z.enum(OFFICE_WORK_KINDS),
    designation: z.string().trim().min(1).max(120).nullable(),
    editionLabel: z.string().trim().min(1).max(120),
  })
  .partial()
  .strict()

export const placeProjectNormsBodySchema = z
  .object({
    destination: z.enum(NORM_DESTINATIONS),
    documents: z
      .array(
        z
          .object({
            documentId: z.guid(),
            values: entryValuesSchema.optional(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_PLACED_NORMS),
    visibility: z
      .literal('office')
      .optional()
      .describe('Required unless project: the office sees it.'),
    confirm: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.destination === 'project' || body.visibility === 'office', {
    message: 'A norm that goes to the office shelf is visible to everyone in the office: send visibility "office".',
    path: ['visibility'],
  })
export type PlaceProjectNormsBody = z.infer<typeof placeProjectNormsBodySchema>

export const NORM_PLACEMENT_OUTCOMES = ['moved', 'edition', 'duplicate', 'suggested', 'kept', 'refused'] as const
export type NormPlacementOutcome = (typeof NORM_PLACEMENT_OUTCOMES)[number]

export const normPlacementSchema = z.object({
  documentId: z.string(),
  outcome: z.enum(NORM_PLACEMENT_OUTCOMES),
  officeDocumentId: z.string().nullable(),
  entryId: z.string().nullable(),
  referenceId: z.string().nullable(),
  proposalId: z.string().nullable(),
  reason: z.string().nullable(),
})
export type NormPlacement = z.infer<typeof normPlacementSchema>

export const placeProjectNormsResponseSchema = z.object({
  destination: z.enum(NORM_DESTINATIONS),
  visibility: z.enum(['office', 'project']),
  placements: z.array(normPlacementSchema),
  notified: z.number().int(),
})
export type PlaceProjectNormsResponse = z.infer<typeof placeProjectNormsResponseSchema>

export const normOfferSchema = z.object({
  documentId: z.string(),
  fileName: z.string(),
  folderId: z.string().nullable(),
  designation: z.string().nullable(),
})
export type NormOffer = z.infer<typeof normOfferSchema>

export const REFERENCE_STATES = ['in_office_shelf', 'removed'] as const
export type ReferenceState = (typeof REFERENCE_STATES)[number]

export const officeShelfReferenceSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  folderId: z.string().nullable(),
  placedAs: z.enum(REFERENCE_PLACEMENTS),
  state: z.enum(REFERENCE_STATES),
  officeDocumentId: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string(),
})
export type OfficeShelfReferenceView = z.infer<typeof officeShelfReferenceSchema>

export const projectNormsResponseSchema = z.object({
  canManageOfficeShelf: z.boolean(),
  canWrite: z.boolean(),
  offers: z.array(normOfferSchema),
  references: z.array(officeShelfReferenceSchema),
  nextCursor: z.string().nullable(),
})
export type ProjectNormsResponse = z.infer<typeof projectNormsResponseSchema>
