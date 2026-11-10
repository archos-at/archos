/**
 * The law at a project's site, as a person reads it (ADR-0175): the knowledge
 * context's gate and its uses, each with the role and qualifier the turn reads
 * (open coverage marks binding law uncurated and the rest information; a work
 * that connects by more than the site informs), named from the graph the
 * context was resolved on. The one read behind `project-base-get` and the
 * intake's Steckbrief, from the turn's own cached resolution, so the page and
 * the answer name the same law in the same role. It replaced
 * `bff/oib/applicable-standards.ts`, which named Austria's OIB guidelines for
 * any site.
 */

import 'server-only'
import type { ProjectLaw } from '../wire/project-law'
import { contextWithNames, type ContextResolution } from './service'
import type { GateState } from './wire'

/** The gate states that name no law: the turn refuses, and so does the page. */
const REFUSING: ReadonlySet<GateState> = new Set(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'])

/** Whether a gate lets the page name law. Pure. */
export const gateNamesLaw = (gate: GateState): boolean => !REFUSING.has(gate)

/** The law a resolution names. Pure. */
export function lawOf({ context, names }: ContextResolution): ProjectLaw {
  const gate = context.gate.state
  if (!gateNamesLaw(gate)) return { gate, uses: [] }
  return {
    gate,
    uses: context.uses.map((use) => ({
      workId: use.workId,
      editionId: use.editionId,
      role: use.role,
      qualifier: use.qualifier,
      designation: names.works[use.workId] ?? null,
      editionLabel: use.editionId ? (names.editions[use.editionId] ?? null) : null,
    })),
  }
}

/** The law at the project's site; `resolved` when the caller already read the resolution. */
export async function projectLawFor(organizationId: string, projectId: string, resolved?: ContextResolution): Promise<ProjectLaw> {
  return lawOf(resolved ?? (await contextWithNames(organizationId, projectId)))
}
