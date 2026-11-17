import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { filterUsersWhoMayReadFolder } from '@/lib/authz/folder-access'
import { filterUsersWithProjectPermission } from '@/lib/authz/project-membership'
import { listAssignmentsForResources } from '@/lib/assignments/repository'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import type { Document } from '@/lib/db/schema/documents'

export interface ReviewCandidate {
  userId: string
  name: string
  email: string | null
}

export async function listReviewCandidates(
  session: AuthorizedSession,
  document: Document,
): Promise<ReviewCandidate[]> {
  if (!document.projectId) return []
  const directory = await loadOrganizationDirectory(session.organizationId)
  const others = [...directory.values()].filter((person) => person.userId !== session.userId)
  if (others.length === 0) return []
  const allowed = await filterUsersWithProjectPermission(
    session,
    document.projectId,
    others.map((person) => person.userId),
    'project:edit',
  )
  const mayOpen = await filterUsersWhoMayReadFolder(
    session.organizationId,
    document.projectId,
    document.folderId,
    others.filter((person) => allowed.has(person.userId)).map((person) => person.userId),
  )
  return others
    .filter((person) => allowed.has(person.userId) && mayOpen.has(person.userId))
    .map((person) => ({ userId: person.userId, name: person.name, email: person.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface ResolvedReviewers {
  reviewers: readonly string[]
  selfReview: boolean
}

export async function resolveReviewers(
  session: AuthorizedSession,
  document: Document,
  named: readonly string[] | undefined,
): Promise<ResolvedReviewers> {
  const stated = [...new Set([...(named ?? [])].filter(Boolean))]
  if (stated.length > 0) return { reviewers: stated, selfReview: false }

  const assignments = await listAssignmentsForResources(session.organizationId, 'document', [
    document.id,
  ])
  const assignees = [
    ...new Set(
      assignments.map((row) => row.subjectUserId).filter((userId) => userId !== session.userId),
    ),
  ]
  if (assignees.length > 0) return { reviewers: assignees, selfReview: false }

  const candidates = await listReviewCandidates(session, document)
  if (candidates.length > 0) {
    return { reviewers: candidates.map((person) => person.userId), selfReview: false }
  }

  return { reviewers: [session.userId], selfReview: true }
}

export function matchReviewCandidate(
  candidates: readonly ReviewCandidate[],
  stated: string,
): { ok: true; userId: string } | { ok: false; reason: 'unknown' | 'ambiguous' } {
  const wanted = stated.trim().toLowerCase()
  const matches = candidates.filter(
    (person) =>
      person.name.trim().toLowerCase() === wanted ||
      (person.email ?? '').trim().toLowerCase() === wanted,
  )
  if (matches.length === 1) return { ok: true, userId: matches[0].userId }
  return { ok: false, reason: matches.length === 0 ? 'unknown' : 'ambiguous' }
}
