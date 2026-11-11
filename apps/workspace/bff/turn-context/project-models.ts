import { isDrawingMeasureEnabled } from '@/lib/authz/feature-flags'
import type { UserSession } from '@/lib/auth/types'
import type { ProjectModelKinds } from '@/lib/bim/model-kinds-repository'

/**
 * The model kinds a turn states to the agent, from what the project holds.
 *
 * An IFC and a DXF bind their tools wherever there is one. A PDF binds
 * `drawing_measure` only where the organization holds the `drawing-measure`
 * entitlement (ADR-0182): the agent has no flag of its own, so this is the gate
 * that keeps the tool dark. Null (no project, or the read failed) stays null.
 */
export function turnProjectModels(
  kinds: ProjectModelKinds | null,
  session: Pick<UserSession, 'featureFlags'>,
): ProjectModelKinds | null {
  return kinds && { ...kinds, pdf: kinds.pdf && isDrawingMeasureEnabled(session) }
}
