/** The review queue's wire (`GET /api/review/queue`), re-exported by `./lifecycle-types.ts`. */

import { z } from 'zod'

export const REVIEW_QUEUE_ROLES = ['reviewer', 'submitter'] as const

/** `GET /api/review/queue`: the versions in review that wait on the person, or that the person sent to review. */
export const reviewQueueQuerySchema = z.object({
  role: z
    .enum(REVIEW_QUEUE_ROLES)
    .default('reviewer')
    .describe('`reviewer` (default): waiting for the person’s decision; `submitter`: sent by the person.'),
  projectId: z.guid().optional().describe('Only this project’s documents.'),
  limit: z.coerce.number().int().min(1).max(50).default(50).describe('Page size (default and most 50).'),
  cursor: z.guid().optional().describe('The previous `nextCursor`.'),
})

export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>

export interface ReviewQueueResponse {
  versions: {
    documentId: string
    documentName: string
    projectId: string | null
    projectName: string | null
    versionId: string
    versionNumber: number
    /** The person who sent it to review. */
    submittedBy: string | null
    submittedByName: string | null
    submittedAt: string | null
  }[]
  nextCursor: string | null
}
