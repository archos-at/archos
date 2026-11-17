import 'server-only'

import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, resolveInboxItemsAnchoredOn } from '@/lib/inbox/service'
import type { ProposalNoticeVariant } from './types'

const TYPE = 'piloti.proposal_waiting'

const SUMMARY_LENGTH = 200

export async function onProposalCreated(input: {
  organizationId: string
  projectId: string | null
  proposalId: string
  originConversationId: string | null
  onBehalfOf: string
  summary: string
  variant: ProposalNoticeVariant
}): Promise<void> {
  await bestEffortInbox(`${TYPE} for proposal ${input.proposalId}`, input.organizationId, () => {
    const [resourceType, resourceId] = input.originConversationId
      ? (['conversation', input.originConversationId] as const)
      : input.projectId
        ? (['project', input.projectId] as const)
        : (['organization', input.organizationId] as const)
    const summary = input.summary.replace(/\s+/g, ' ').trim()
    return emitInboxItems([
      {
        organizationId: input.organizationId,
        recipientUserId: input.onBehalfOf,
        type: TYPE,
        resourceType,
        resourceId,
        anchorId: input.proposalId,
        actorUserId: null,
        groupKey: inboxGroupKey(TYPE, resourceType, resourceId, input.proposalId),
        payload: {
          variant: input.variant,
          ...(summary
            ? { excerpt: summary.length > SUMMARY_LENGTH ? `${summary.slice(0, SUMMARY_LENGTH - 1)}…` : summary }
            : {}),
        },
      },
    ])
  })
}

export async function onProposalDecided(input: { organizationId: string; proposalId: string }): Promise<void> {
  await bestEffortInbox(`settling proposal ${input.proposalId}`, input.organizationId, () =>
    resolveInboxItemsAnchoredOn({
      organizationId: input.organizationId,
      types: [TYPE],
      anchorId: input.proposalId,
    })
  )
}
