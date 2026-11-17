import 'server-only'
import { proposalEventSchema, proposalTopic } from '@/lib/proposals/live-events'
import { requireReadableProposal } from '@/lib/proposals/service'
import { defineChannel } from './channel'

export const PROPOSAL_REAUTHORIZE_MS = 30_000

const PROPOSAL_ID = /^[A-Za-z0-9_-]{1,128}$/

export const proposalChannel = defineChannel({
  kind: 'proposal',
  parse: (id) => (PROPOSAL_ID.test(id) ? { proposalId: id } : null),
  topics: ({ proposalId }) => [proposalTopic(proposalId)],
  authorize: async (session, { proposalId }) => {
    await requireReadableProposal(session, proposalId)
  },
  reauthorizeMs: PROPOSAL_REAUTHORIZE_MS,
  events: proposalEventSchema,
})
