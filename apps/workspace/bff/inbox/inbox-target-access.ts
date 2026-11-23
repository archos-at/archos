import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem, InboxTargetType } from '@/lib/db/schema/inbox'
import { unreadableRunIds, type RunRef } from '@/lib/tasks/subject-access'
import { findInboxTarget, type InboxTargetAccess } from './targets'
import { nonEmpty } from './inbox-payload-coercion'

export function targetKey(resourceType: InboxTargetType, resourceId: string): string {
  return `${resourceType}:${resourceId}`
}

export async function resolveTargets(
  session: AuthorizedSession,
  rows: readonly InboxItem[],
): Promise<Map<string, InboxTargetAccess | null>> {
  const distinct = new Map<string, { resourceType: InboxTargetType; resourceId: string }>()
  for (const row of rows) {
    if (row.inertAt) continue
    const key = targetKey(row.resourceType, row.resourceId)
    if (!distinct.has(key)) {
      distinct.set(key, { resourceType: row.resourceType, resourceId: row.resourceId })
    }
  }

  const resolved = await Promise.all(
    [...distinct].map(async ([key, target]) => {
      const descriptor = findInboxTarget(target.resourceType)
      if (!descriptor) return [key, null] as const
      try {
        return [key, await descriptor.resolve(session, target.resourceId)] as const
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          console.warn(`[inbox] re-authorization failed for ${key}, redacting item(s):`, error)
        }
        return [key, null] as const
      }
    }),
  )

  return new Map(resolved)
}

function runRefOf(row: InboxItem): RunRef | null {
  if (row.inertAt || row.resourceType !== 'project') return null
  const payload: Record<string, unknown> = row.payload ?? {}
  const runId = nonEmpty(payload.runId) ?? nonEmpty(payload.taskId)
  return runId ? { projectId: row.resourceId, runId } : null
}

export async function rowsWithUnreadableRuns(session: AuthorizedSession, rows: readonly InboxItem[]): Promise<Set<string>> {
  const refs = rows.flatMap((row) => {
    const ref = runRefOf(row)
    return ref ? [{ rowId: row.id, ref }] : []
  })
  if (refs.length === 0) return new Set()
  const unreadable = await unreadableRunIds(
    session,
    refs.map(({ ref }) => ref),
  )
  return new Set(refs.filter(({ ref }) => unreadable.has(ref.runId)).map(({ rowId }) => rowId))
}
