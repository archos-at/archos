import 'server-only'

import {
  DIGEST_BLOCK_MAX_CHARS,
  formatBoundedDigest,
  type DigestLineItem,
} from '@/lib/knowledge/digest-format'
import { resolvePeople } from '@/lib/sharing/directory'
import { listRefusedVersionsForConversation } from './version-repository'

export const REVIEW_DECISIONS_HEADER = 'REVIEW_DECISIONS v1'

export const MAX_REVIEW_DECISIONS = 5

const VERDICT: Record<string, string> = {
  changes_requested: 'changes requested',
  rejected: 'rejected',
}

export async function buildReviewDecisionsBlock(
  conversationId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await listRefusedVersionsForConversation(
    conversationId,
    organizationId,
    MAX_REVIEW_DECISIONS,
  )
  if (rows.length === 0) return null

  const reviewerIds = [...new Set(rows.map((row) => row.reviewedBy).filter((id): id is string => Boolean(id)))]
  const people = await resolvePeople(organizationId, reviewerIds)

  const items: DigestLineItem[] = rows.map((row) => {
    const who = row.reviewedBy ? people.get(row.reviewedBy)?.name : undefined
    const when = row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : undefined
    const title = row.displayName?.trim() || row.filename
    return {
      tags: [
        VERDICT[row.state] ?? row.state,
        title,
        `v${row.versionNumber}`,
        ...(who ? [who] : []),
        ...(when ? [when] : []),
      ],
      content: row.reviewComment,
    }
  })

  return formatBoundedDigest(REVIEW_DECISIONS_HEADER, items, DIGEST_BLOCK_MAX_CHARS)
}
