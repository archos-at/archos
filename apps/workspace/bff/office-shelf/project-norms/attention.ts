import 'server-only'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, type InboxEmission } from '@/lib/inbox/service'

const SUGGESTED = 'office_shelf.norm_suggested' as const

const EXCERPT_LENGTH = 200

function excerptOf(names: readonly string[]): string {
  const joined = names.join(', ')
  return joined.length > EXCERPT_LENGTH ? `${joined.slice(0, EXCERPT_LENGTH - 1)}…` : joined
}

export async function announceNorms(organizationId: string, emissions: readonly InboxEmission[]): Promise<void> {
  if (emissions.length === 0) return
  await bestEffortInbox(`${emissions[0].type} for ${emissions.length} recipients`, organizationId, () => emitInboxItems([...emissions]))
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
