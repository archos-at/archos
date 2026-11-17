import 'server-only'
import type { DocumentShelf } from '@/lib/documents/shelf'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, type JobSliceResult, type SearchFacetsSyncPayload } from '@/lib/jobs-queue/types'
import {
  claimShelfRefresh,
  listShelfDocumentsForProjection,
  markShelfSynced,
  PROJECTION_PAGE_SIZE,
  readShelfSyncStates,
  shelfKey,
  shelfOfKey,
  shelfSourceFingerprints,
} from './facets-repository'
import { projectDocuments } from './refresh-rows'

export const SHELF_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000

export const SHELF_SYNC_MAX_AGE_MS = 60 * 60 * 1000

export const MAX_REFRESHES_PER_SEARCH = 20

export async function runSearchFacetsSyncSlice(
  organizationId: string,
  payload: SearchFacetsSyncPayload
): Promise<JobSliceResult<SearchFacetsSyncPayload>> {
  const shelf = shelfOfKey(payload.shelfKey)
  if (!shelf) return { done: true, payload }
  const page = await listShelfDocumentsForProjection(organizationId, shelf, payload.afterId)
  const written = await projectDocuments(organizationId, page)
  const next = { ...payload, written: payload.written + written }
  if (page.length < PROJECTION_PAGE_SIZE) {
    await markShelfSynced(organizationId, shelf, payload.sourceFingerprint)
    return { done: true, payload: next }
  }
  return { done: false, payload: { ...next, afterId: page[page.length - 1].id } }
}

export interface ShelfFreshness {
  building: string[]
}

export async function refreshStaleShelves(
  organizationId: string,
  shelves: readonly DocumentShelf[],
  now: Date = new Date()
): Promise<ShelfFreshness> {
  try {
    const [fingerprints, states] = await Promise.all([
      shelfSourceFingerprints(organizationId, shelves),
      readShelfSyncStates(organizationId, shelves.map(shelfKey)),
    ])
    const stateOf = new Map(states.map((state) => [state.shelfKey, state]))
    const building: string[] = []
    let queued = 0
    for (const shelf of shelves) {
      const key = shelfKey(shelf)
      const state = stateOf.get(key)
      const fingerprint = fingerprints.get(key) ?? '0'
      if (!state?.syncedAt) building.push(key)
      if (!isStale(state, fingerprint, now) || queued >= MAX_REFRESHES_PER_SEARCH) continue
      if (!(await claimShelfRefresh(organizationId, shelf, SHELF_REFRESH_MIN_INTERVAL_MS))) continue
      queued += 1
      await enqueueJob({
        kind: 'search_facets_sync',
        organizationId,
        payload: { shelfKey: key, afterId: null, sourceFingerprint: fingerprint, written: 0 } satisfies SearchFacetsSyncPayload,
        priority: BFF_JOB_PRIORITY.bulk,
      })
    }
    return { building }
  } catch (error) {
    console.warn('[search] could not check the projection of the shelves', error)
    return { building: [] }
  }
}

export function isStale(
  state: { syncedAt: Date | null; sourceFingerprint: string | null } | undefined,
  fingerprint: string,
  now: Date
): boolean {
  if (!state?.syncedAt) return true
  if (state.sourceFingerprint !== fingerprint) return true
  return now.getTime() - new Date(state.syncedAt).getTime() > SHELF_SYNC_MAX_AGE_MS
}
