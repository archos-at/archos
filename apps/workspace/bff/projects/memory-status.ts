import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { ConflictError } from '@/lib/api/errors'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import { PROJECT_MEMORY_LIFECYCLE, type ProjectMemoryStatus } from './memory-vocabulary'

export const supersedable = (): SQL => inArray(projectMemory.status, [...PROJECT_MEMORY_LIFECYCLE.sourcesOf('supersede')])

export function statusMayBecome(to: ProjectMemoryStatus | undefined): SQL | undefined {
  if (to === undefined) return undefined
  return inArray(projectMemory.status, [to, ...PROJECT_MEMORY_LIFECYCLE.statesThatMayBecome(to)])
}

export async function refuseStatusMove(
  itemId: string,
  reachable: SQL | undefined,
  to: ProjectMemoryStatus
): Promise<null> {
  const [row] = await getDb()
    .select({ status: projectMemory.status })
    .from(projectMemory)
    .where(and(eq(projectMemory.id, itemId), reachable))
    .limit(1)
  if (!row) return null
  const from = row.status
  const allowed = PROJECT_MEMORY_LIFECYCLE.states.filter((state) => PROJECT_MEMORY_LIFECYCLE.canTransition(from, state))
  throw new ConflictError(`A ${from} note cannot become ${to}`, { reason: 'invalid-transition', from, to, allowed })
}
