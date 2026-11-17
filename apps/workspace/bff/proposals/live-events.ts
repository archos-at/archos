import { z } from 'zod'
import type { ProposedChangeStatus } from './types'

export const proposalChannelKey = (proposalId: string) => `proposal:${proposalId}`

export const proposalTopic = (proposalId: string) => `rt:proposal:${proposalId}`

export const proposalEventSchema = z.object({
  kind: z.literal('proposal.decided'),
  proposalId: z.string().min(1).max(128),
  status: z.enum(['applied', 'partially_applied', 'failed', 'dismissed'] as const satisfies readonly ProposedChangeStatus[]),
})
export type ProposalEvent = z.infer<typeof proposalEventSchema>
