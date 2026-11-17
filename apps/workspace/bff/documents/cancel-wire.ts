import { z } from 'zod'

export const CANCEL_INGEST_OUTCOMES = ['cancelled', 'finished', 'unavailable'] as const

export type CancelIngestOutcome = (typeof CANCEL_INGEST_OUTCOMES)[number]

const statusAfterStop = z
  .string()
  .optional()
  .describe(
    'The status the document holds after the stop. `result` says what the queue did; a read that ended in the same ' +
      'moment can leave the document `completed` or `failed` although a job was stopped.',
  )

export const cancelIngestResultSchema = z.object({
  id: z.string(),
  result: z.enum(CANCEL_INGEST_OUTCOMES),
  status: statusAfterStop,
})

export type CancelIngestResult = Required<z.infer<typeof cancelIngestResultSchema>>
