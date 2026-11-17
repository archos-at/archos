import 'server-only'

import { publish } from '@/lib/realtime/hub'
import { proposalEventSchema, proposalTopic, type ProposalEvent } from './live-events'

export async function publishProposalDecided(
  proposalId: string,
  status: ProposalEvent['status']
): Promise<void> {
  await publish(proposalTopic(proposalId), proposalEventSchema.parse({ kind: 'proposal.decided', proposalId, status }))
}
