import { z } from 'zod'

export const TURN_OUTCOMES = ['answered', 'refused', 'handed_off', 'stopped', 'failed'] as const
export type TurnOutcome = (typeof TURN_OUTCOMES)[number]

export const turnOutcomeRequestSchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    turnId: z.guid(),
    outcome: z.enum(TURN_OUTCOMES),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
export type TurnOutcomeRequest = z.infer<typeof turnOutcomeRequestSchema>

export const turnOutcomeResponseSchema = z.object({ settled: z.boolean() }).strict()
export type TurnOutcomeResponse = z.infer<typeof turnOutcomeResponseSchema>
