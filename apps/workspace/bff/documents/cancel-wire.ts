/**
 * What `POST /api/documents/{id}/cancel` answers, as the route sends it and as
 * its clients read it. No `server-only`: the upload tray and the document menu
 * parse the answer with the same schema the service types its result by.
 */

import { z } from 'zod'

/**
 * What the stop did:
 *
 *  - `cancelled`: the durable queue stopped a live job.
 *  - `finished`: there was no live job to stop; the read had already ended.
 *  - `unavailable`: nothing this tier can stop (the queue is off, or the work
 *    runs inside the BFF and carries no job id).
 */
export const CANCEL_INGEST_OUTCOMES = ['cancelled', 'finished', 'unavailable'] as const

export type CancelIngestOutcome = (typeof CANCEL_INGEST_OUTCOMES)[number]

/**
 * Optional on the wire only: a server from before the field does not send it,
 * and a client must then decide without it.
 */
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

/** The answer as the service builds it: the status is always there. */
export type CancelIngestResult = Required<z.infer<typeof cancelIngestResultSchema>>
