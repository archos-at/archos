import { z } from 'zod'
import { DOCUMENT_AUTHORS } from './document-authors'
import { DOCUMENT_LIFECYCLES } from './lifecycle-vocabulary'
import { shelfSelectorFields } from './shelf-scope'

export const NAME_PROBE_MAX_NAMES = 2000

const names = z.array(z.string().min(1).max(1024)).min(1).max(NAME_PROBE_MAX_NAMES)

export const nameProbeRequestSchema = z.object({ ...shelfSelectorFields, names })

export const revisionCandidatesRequestSchema = nameProbeRequestSchema.extend({
  folders: z
    .record(z.string().min(1).max(1024), z.string().min(1).max(64).nullable())
    .refine((folders) => Object.keys(folders).length <= NAME_PROBE_MAX_NAMES, 'Too many names')
    .optional(),
})
export type RevisionCandidatesRequest = z.infer<typeof revisionCandidatesRequestSchema>

export const documentNameMatchSchema = z.object({
  id: z.string(),
  filename: z.string(),
  displayName: z.string().nullable(),
  fileSize: z.number().nullable(),
  contentHash: z.string().nullable(),
  status: z.string(),
  folderId: z.string().nullable(),
  authoredBy: z.enum(DOCUMENT_AUTHORS),
  lifecycle: z.enum(DOCUMENT_LIFECYCLES),
})
export type DocumentNameMatch = z.infer<typeof documentNameMatchSchema>

export const nameProbeResponseSchema = z.object({ documents: z.array(documentNameMatchSchema) })
export type NameProbeResponse = z.infer<typeof nameProbeResponseSchema>

export const revisionCandidateSchema = z.object({
  name: z.string(),
  candidates: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        displayName: z.string().nullable(),
        label: z.string(),
      }),
    )
    .min(1),
  newer: z.boolean(),
  unambiguous: z.boolean(),
})
export type RevisionCandidateMatch = z.infer<typeof revisionCandidateSchema>

export const revisionCandidatesResponseSchema = z.object({ candidates: z.array(revisionCandidateSchema) })
export type RevisionCandidatesResponse = z.infer<typeof revisionCandidatesResponseSchema>
