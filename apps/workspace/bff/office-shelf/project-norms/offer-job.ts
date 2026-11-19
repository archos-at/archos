import { z } from 'zod'

export const normOfferPayloadSchema = z.object({
  batchId: z.string().min(1),
  projectId: z.string().min(1),
  createdBy: z.string().min(1),
})

export type NormOfferPayload = z.infer<typeof normOfferPayloadSchema>

export const normOfferJobId = (batchId: string) => `office-shelf-norm-offer:${batchId}`

export function normOffersOf(
  completed: readonly { id: string; scope: string; projectId: string | null; createdBy: string }[],
): NormOfferPayload[] {
  return completed.flatMap((batch) =>
    batch.scope === 'project' && batch.projectId ? [{ batchId: batch.id, projectId: batch.projectId, createdBy: batch.createdBy }] : [],
  )
}
