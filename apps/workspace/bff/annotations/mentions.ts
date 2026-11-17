import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { PRODUCT_NAME } from '@/lib/brand'
import { mayOpenDocument, type OpenableDocument } from '@/lib/documents/may-open'
import { isAgentMentionId } from '@/lib/mentions/types'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { reconcileMentions } from '@/lib/mentions/mention-text'
import type { MarkMention } from './types'

export function standingMentions(text: string, mentions: readonly MarkMention[]): MarkMention[] {
  const seen = new Set<string>()
  return reconcileMentions(text, mentions).filter((mention) => {
    if (seen.has(mention.targetId)) return false
    seen.add(mention.targetId)
    return true
  })
}

export async function keepMentions(
  session: AuthorizedSession,
  doc: OpenableDocument,
  text: string,
  submitted: readonly MarkMention[],
  { piloti }: { piloti: boolean }
): Promise<MarkMention[]> {
  const standing = standingMentions(text, submitted)
  const isAgent = (mention: MarkMention) => isAgentMentionId(mention.targetId)
  const keptAgent = (mention: MarkMention) => piloti && mention.display === PRODUCT_NAME
  const people = isCollaborationEnabled(session) ? standing.filter((mention) => !isAgent(mention)) : []
  if (people.length === 0) return standing.filter((mention) => isAgent(mention) && keptAgent(mention))
  const directory = await loadOrganizationDirectory(session.organizationId)
  const named = people.filter((mention) => directory.get(mention.targetId)?.name === mention.display)
  const mayOpen = await mayOpenDocument(
    session,
    doc,
    named.map((mention) => mention.targetId)
  )
  return standing.filter((mention) =>
    isAgent(mention) ? keptAgent(mention) : named.includes(mention) && mayOpen.has(mention.targetId)
  )
}

export function newlyMentioned(
  after: readonly MarkMention[],
  before: readonly MarkMention[],
  writerUserId: string
): string[] {
  const already = new Set(before.map((mention) => mention.targetId))
  return [
    ...new Set(
      after
        .map((mention) => mention.targetId)
        .filter((targetId) => !isAgentMentionId(targetId) && targetId !== writerUserId && !already.has(targetId))
    ),
  ]
}

export const mentionsAgent = (mentions: readonly MarkMention[]): boolean =>
  mentions.some((mention) => isAgentMentionId(mention.targetId))

export function noLongerMentioned(
  before: readonly MarkMention[],
  remaining: ReadonlyArray<readonly MarkMention[]>
): string[] {
  const still = new Set(remaining.flat().map((mention) => mention.targetId))
  return [
    ...new Set(
      before
        .map((mention) => mention.targetId)
        .filter((targetId) => !isAgentMentionId(targetId) && !still.has(targetId))
    ),
  ]
}
