import 'server-only'
import { randomUUID } from 'node:crypto'
import { listProjectsWithRestrictedFolders } from '@/lib/authz/folder-access-repository'
import { retryProjectPlacement } from './collection-placement'

export const PLACEMENT_SWEEP_PROJECTS = 50

export const PLACEMENT_SWEEP_BUDGET_MS = 60_000

export interface PlacementSweepResult {
  checked: number
  moved: number
  pending: number
  failed: number
}

let cursor: string = randomUUID()

type RestrictedProject = { organizationId: string; projectId: string }

async function nextProjects(limit: number): Promise<RestrictedProject[]> {
  const tail = await listProjectsWithRestrictedFolders({ after: cursor, upTo: null, limit })
  if (tail.length === limit) return tail
  const head = await listProjectsWithRestrictedFolders({ after: null, upTo: cursor, limit: limit - tail.length })
  return [...tail, ...head]
}

export async function sweepCollectionPlacement(): Promise<PlacementSweepResult> {
  const deadline = Date.now() + PLACEMENT_SWEEP_BUDGET_MS
  const result: PlacementSweepResult = { checked: 0, moved: 0, pending: 0, failed: 0 }
  for (const { organizationId, projectId } of await nextProjects(PLACEMENT_SWEEP_PROJECTS)) {
    if (Date.now() >= deadline) break
    cursor = projectId
    result.checked += 1
    try {
      const placed = await retryProjectPlacement(organizationId, projectId, 'sweep')
      result.moved += placed.moved
      result.pending += placed.failed.length + placed.pending
    } catch (error) {
      result.failed += 1
      console.warn(`[placement] sweep could not place project ${projectId}:`, error)
    }
  }
  return result
}
