import 'server-only'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, resolveInboxItemsAnchoredOn, type InboxEmission } from '@/lib/inbox/service'
import type { NormOffer } from './wire'

const OFFERED = 'office_shelf.norm_offered' as const
const SUGGESTED = 'office_shelf.norm_suggested' as const

const EXCERPT_LENGTH = 200

function excerptOf(names: readonly string[]): string {
  const joined = names.join(', ')
  return joined.length > EXCERPT_LENGTH ? `${joined.slice(0, EXCERPT_LENGTH - 1)}…` : joined
}

export function normOfferEmissions(input: {
  organizationId: string
  projectId: string
  projectName: string
  recipientUserId: string
  offers: readonly NormOffer[]
}): InboxEmission[] {
  return input.offers.map((offer) => ({
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
    type: OFFERED,
    resourceType: 'project',
    resourceId: input.projectId,
    anchorId: offer.documentId,
    actorUserId: null,
    groupKey: inboxGroupKey(OFFERED, 'project', input.projectId, offer.documentId),
    payload: {
      subject: input.projectName,
      excerpt: excerptOf([offer.designation ?? offer.fileName]),
      ...(offer.folderId ? { folderId: offer.folderId } : {}),
    },
  }))
}

export async function announceNorms(organizationId: string, emissions: readonly InboxEmission[]): Promise<void> {
  if (emissions.length === 0) return
  await bestEffortInbox(`${emissions[0].type} for ${emissions.length} recipients`, organizationId, () => emitInboxItems([...emissions]))
}

export async function settleNormOffers(organizationId: string, documentIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`settling ${OFFERED}`, organizationId, async () => {
    for (const anchorId of documentIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [OFFERED], anchorId })
    }
  })
}

export function normSuggestionEmissions(input: {
  organizationId: string
  projectId: string
  projectName: string
  proposalId: string
  suggestedBy: string
  recipients: readonly string[]
  names: readonly string[]
  folderId: string | null
}): InboxEmission[] {
  return input.recipients.map((recipientUserId) => ({
    organizationId: input.organizationId,
    recipientUserId,
    type: SUGGESTED,
    resourceType: 'project',
    resourceId: input.projectId,
    anchorId: input.proposalId,
    actorUserId: input.suggestedBy,
    groupKey: inboxGroupKey(SUGGESTED, 'project', input.projectId, input.proposalId),
    payload: {
      subject: input.projectName,
      excerpt: excerptOf(input.names),
      ...(input.folderId ? { folderId: input.folderId } : {}),
    },
  }))
}
