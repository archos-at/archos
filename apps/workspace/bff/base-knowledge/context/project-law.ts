/**
 * The law at a project's site, as a person reads it (ADR-0175): the knowledge
 * context's gate and the chain's editions with designation, edition and role.
 * The one read behind `project-base-get` and the intake's Steckbrief, so the
 * page and the turn name the same law. It replaced `bff/oib/applicable-standards.ts`,
 * which named Austria's OIB guidelines for any site.
 */

import 'server-only'
import { buildingLawForTurn } from '../chain/turn'
import type { ProjectLaw } from './operations-wire'
import { knowledgeContextForTurn } from './service'
import type { GateState, KnowledgeContext } from './wire'

/** The gate states that name no law: the turn refuses, and so does the page. */
const REFUSING: ReadonlySet<GateState> = new Set(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'])

/** Whether a gate lets the page name law. Pure. */
export const gateNamesLaw = (gate: GateState): boolean => !REFUSING.has(gate)

/** The law at the project's site; `context` when the caller already resolved it. */
export async function projectLawFor(organizationId: string, projectId: string, context?: KnowledgeContext): Promise<ProjectLaw> {
  const [resolved, chain] = await Promise.all([
    context ?? knowledgeContextForTurn(organizationId, projectId, undefined, null, 'operation'),
    // A chain that cannot be read names nothing, and says so: never "no law here".
    buildingLawForTurn(organizationId, projectId).then(
      (read) => ({ read }),
      (error: unknown) => {
        console.error('[project-law] the chain could not be read', { organizationId, projectId, error })
        return null
      },
    ),
  ])
  if (!chain) return { gate: 'knowledge_unavailable', uses: [] }
  const law = chain.read
  const gate = resolved.gate.state
  if (!gateNamesLaw(gate) || !law) return { gate, uses: [] }
  return {
    gate,
    uses: law.uses.map(({ workId, editionId, role, designation, editionLabel }) => ({ workId, editionId, role, designation, editionLabel })),
  }
}
