import 'server-only'

import type { RootSortRun } from '@/lib/db/schema/root-sort-runs'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { recipientsHoldingGroup } from '@/lib/inbox/repository'
import { emitInboxItems, resolveInboxItemsAnchoredOn, type InboxEmission } from '@/lib/inbox/service'
import { findProjectInOrg } from '@/lib/projects/repository'
import type { RootSortPlacement } from './root-sort-types'

export async function announceRootSortRun(run: RootSortRun): Promise<void> {
  if (run.status !== 'ready' && run.status !== 'failed') return
  const type = run.status === 'ready' ? 'root_sort.ready' : 'root_sort.failed'
  const moves = run.status === 'ready' ? proposedMoves(run.placements) : 1
  if (moves === 0) return
  await bestEffortInbox(`${type} for run ${run.id}`, run.organizationId, async () => {
    const emission = await emissionOf(run, type, moves)
    if (!emission) return
    const told = await recipientsHoldingGroup(run.organizationId, emission.groupKey, [emission.recipientUserId])
    if (told.has(emission.recipientUserId)) return
    await emitInboxItems([emission])
  })
}

export async function settleRootSortNotices(run: RootSortRun): Promise<void> {
  const stale = [
    ...(run.status === 'ready' ? [] : (['root_sort.ready'] as const)),
    ...(run.status === 'failed' ? [] : (['root_sort.failed'] as const)),
  ]
  await bestEffortInbox(`settling the notices of run ${run.id}`, run.organizationId, async () => {
    await resolveInboxItemsAnchoredOn({
      organizationId: run.organizationId,
      types: stale,
      anchorId: run.id,
      recipientUserId: run.requestedBy,
    })
  })
}

function proposedMoves(placements: readonly RootSortPlacement[]): number {
  return placements.filter((placement) => placement.folderId !== null || placement.newFolderPath !== null).length
}

async function emissionOf(
  run: RootSortRun,
  type: 'root_sort.ready' | 'root_sort.failed',
  moves: number
): Promise<InboxEmission | null> {
  const common = {
    organizationId: run.organizationId,
    recipientUserId: run.requestedBy,
    type,
    anchorId: run.id,
    actorUserId: null,
    occurrences: moves,
  }
  if (run.scope === 'project' && run.projectId) {
    const project = await findProjectInOrg(run.projectId, run.organizationId)
    if (!project) return null
    return {
      ...common,
      resourceType: 'project',
      resourceId: run.projectId,
      groupKey: inboxGroupKey(type, 'project', run.projectId, run.id),
      payload: { subject: project.name },
    }
  }
  return {
    ...common,
    resourceType: 'organization',
    resourceId: run.organizationId,
    groupKey: inboxGroupKey(type, 'organization', run.organizationId, run.id),
    payload: { variant: 'office' },
  }
}
