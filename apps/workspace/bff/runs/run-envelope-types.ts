import { z } from 'zod'

export const runEnvelopeRequestSchema = z.object({}).strict()
export type RunEnvelopeRequest = z.infer<typeof runEnvelopeRequestSchema>

export const runEnvelopeResponseSchema = z
  .object({
    header: z.string().min(1),
    signature: z.string().min(1),
    issuedAt: z.number().int().positive(),
  })
  .strict()
export type RunEnvelopeResponse = z.infer<typeof runEnvelopeResponseSchema>

export const RUN_ENVELOPE_REFUSALS = ['unknown-run', 'run-not-active', 'requester-may-not-act'] as const
export type RunEnvelopeRefusal = (typeof RUN_ENVELOPE_REFUSALS)[number]

export const runEnvelopeErrorSchema = z
  .object({ error: z.enum(RUN_ENVELOPE_REFUSALS), message: z.string() })
  .strict()
export type RunEnvelopeError = z.infer<typeof runEnvelopeErrorSchema>

export const RUN_ENVELOPE_RENEW_AFTER_MS = 60 * 60 * 1000
