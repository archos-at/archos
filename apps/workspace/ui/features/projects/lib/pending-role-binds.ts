import { defaultBuildings } from '@/lib/project-profile/intake-building-keys'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import { documentRoleDefinition, type DocumentRole } from '@/lib/project-profile/document-roles'
import type { ProjectProfile } from '@/lib/project-profile/types'

export interface PendingRoleBind {
  documentId: string
  filename: string
  role: DocumentRole
  scopeInstanceId: string
}

export function persistedBuildingIds(
  profile: ProjectProfile | null | undefined,
  definition: ProjectIntakeDefinition | null
): ReadonlySet<string> {
  const buildings =
    profile && definition ? answersFromProfile(profile, definition).buildings : defaultBuildings()
  return new Set(buildings.map((building) => building.id))
}

export function withPendingBind(
  pending: readonly PendingRoleBind[],
  next: PendingRoleBind
): PendingRoleBind[] {
  const sameSlot = (bind: PendingRoleBind) =>
    bind.role === next.role && bind.scopeInstanceId === next.scopeInstanceId
  const single = documentRoleDefinition(next.role).cardinality === 'one'
  const kept = pending.filter(
    (bind) => !(sameSlot(bind) && (single || bind.documentId === next.documentId))
  )
  return [...kept, next]
}

export function withoutBuilding(
  pending: readonly PendingRoleBind[],
  buildingId: string
): PendingRoleBind[] {
  return pending.filter((bind) => bind.scopeInstanceId !== buildingId)
}

export function withoutPendingBind(
  pending: readonly PendingRoleBind[],
  removed: PendingRoleBind
): PendingRoleBind[] {
  return pending.filter(
    (bind) =>
      !(
        bind.documentId === removed.documentId &&
        bind.role === removed.role &&
        bind.scopeInstanceId === removed.scopeInstanceId
      )
  )
}

export function pendingBindsFromDraft(raw: unknown): PendingRoleBind[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry): entry is PendingRoleBind =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as PendingRoleBind).documentId === 'string' &&
      typeof (entry as PendingRoleBind).filename === 'string' &&
      typeof (entry as PendingRoleBind).role === 'string' &&
      typeof (entry as PendingRoleBind).scopeInstanceId === 'string'
  )
}

export async function sendPendingBinds(
  projectId: string,
  pending: readonly PendingRoleBind[],
  post: typeof fetch = fetch
): Promise<PendingRoleBind[]> {
  const refused: PendingRoleBind[] = []
  for (const bind of pending) {
    try {
      const response = await post(`/api/projects/${projectId}/document-roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: bind.documentId,
          role: bind.role,
          scopeInstanceId: bind.scopeInstanceId,
        }),
      })
      if (!response.ok) refused.push(bind)
    } catch {
      refused.push(bind)
    }
  }
  return refused
}

export function createUploadTracker(): {
  track: (work: Promise<unknown>) => void
  settled: () => Promise<void>
} {
  const inFlight = new Set<Promise<unknown>>()
  return {
    track(work) {
      inFlight.add(work)
      const done = () => {
        inFlight.delete(work)
      }
      work.then(done, done)
    },
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
  }
}
