/**
 * The status moves of a project or office note, read from
 * {@link PROJECT_MEMORY_LIFECYCLE} (ADR-0179): the WHERE each writer of
 * `project_memory.status` matches on, and the 409 a refused move answers.
 *
 * Before the declaration, `updateProjectMemoryItem` set any status the PATCH
 * named, so a note could move anywhere, including into `proposed`, a state no
 * reader knew.
 */

import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { ConflictError } from '@/lib/api/errors'
import { getDb } from '@/lib/db'
import { projectMemory } from '@/lib/db/schema/project-memory'
import { PROJECT_MEMORY_LIFECYCLE, type ProjectMemoryStatus } from './memory-vocabulary'

/** The states a write that supersedes a note matches on: an `active` note only. */
export const supersedable = (): SQL => inArray(projectMemory.status, [...PROJECT_MEMORY_LIFECYCLE.sourcesOf('supersede')])

/**
 * The condition a PATCH that names `to` adds to its UPDATE: the note is in a
 * state that may become `to`, or already in `to` (naming the status a note
 * has is no move, and changes nothing). Undefined when the patch names none.
 */
export function statusMayBecome(to: ProjectMemoryStatus | undefined): SQL | undefined {
  if (to === undefined) return undefined
  return inArray(projectMemory.status, [to, ...PROJECT_MEMORY_LIFECYCLE.statesThatMayBecome(to)])
}

/**
 * Called when a PATCH that names `to` matched no row: a note the caller can
 * reach that may not make that move is a 409 `invalid-transition`; a note the
 * caller cannot reach stays a null, the route's 404.
 */
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
