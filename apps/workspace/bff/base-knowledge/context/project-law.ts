/**
 * The law at a project's site, as a person reads it (ADR-0175): the knowledge
 * context's gate and its uses, each with the role and qualifier the turn reads
 * (open coverage marks binding law uncurated and the rest information; a work
 * that connects by more than the site informs), named as the uses name
 * themselves. The one read behind `project-base-get` and the
 * intake's Steckbrief, from the turn's own cached resolution, so the page and
 * the answer name the same law in the same role. It replaced
 * `bff/oib/applicable-standards.ts`, which named Austria's OIB guidelines for
 * any site.
 */

import 'server-only'
import { gateNamesLaw, type ProjectLaw } from '../wire/project-law'
import { contextForPage } from './service'
import type { KnowledgeContext } from './wire'

/** The law a context names, with the names its uses carry. Pure. */
export function lawOf(context: KnowledgeContext): ProjectLaw {
  const gate = context.gate.state
  if (!gateNamesLaw(gate)) return { gate, uses: [] }
  return {
    gate,
    uses: context.uses.map((use) => ({
      workId: use.workId,
      editionId: use.editionId,
      role: use.role,
      qualifier: use.qualifier,
      designation: use.designation,
      editionLabel: use.editionLabel,
    })),
  }
}

/** The law at the project's site, from the context the turn reads. */
export async function projectLawFor(organizationId: string, projectId: string): Promise<ProjectLaw> {
  return lawOf(await contextForPage(organizationId, projectId))
}
