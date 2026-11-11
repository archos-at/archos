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
import { gateNamesLaw, MAX_PROJECT_LAW_USES, type ProjectLaw } from '../wire/project-law'
import { SHIPPED_SETUP_RECORDS } from '../rulesets/shipped'
import { selectRecord } from '../rulesets/select'
import { calendarDayIn } from '@/lib/format'
import { contextForPage } from './service'
import type { KnowledgeContext } from './wire'

/**
 * The label of each building fact the uses' scopes name, in the country's
 * terms: its `fact_definitions` on the context's own chain (ADR-0169), as of
 * `on`. Labels are vocabulary, read today like the project's buildings are
 * (`projectBuildings`), never on a past filing day the context may resolve on.
 */
function factLabelsOf(context: KnowledgeContext, on: string): Record<string, string> {
  const keys = context.uses.flatMap((use) => [...(use.applicability?.basis ?? []), ...(use.applicability?.open ?? [])])
  if (keys.length === 0) return {}
  const chain = context.chains[context.gate.leaves[0]?.territoryId ?? ''] ?? []
  const selection = selectRecord(SHIPPED_SETUP_RECORDS, { purpose: 'fact_definitions', chain, on })
  const body = selection.status === 'found' ? selection.ruleset.values.body : null
  const labels = new Map((body?.kind === 'fact_definitions' ? body.payload.facts : []).map((fact) => [fact.key, fact.label]))
  return Object.fromEntries(keys.map((key) => [key, labels.get(key) ?? key]))
}

/** The law a context names, its first `MAX_PROJECT_LAW_USES` uses with the names they carry; fact labels as of `labelsOn` (today). */
export function lawOf(context: KnowledgeContext, labelsOn: string = calendarDayIn('UTC')): ProjectLaw {
  const gate = context.gate.state
  if (!gateNamesLaw(gate)) return { gate, uses: [], factLabels: {} }
  return {
    gate,
    uses: context.uses.slice(0, MAX_PROJECT_LAW_USES).map((use) => ({
      workId: use.workId,
      editionId: use.editionId,
      role: use.role,
      qualifier: use.qualifier,
      designation: use.designation,
      editionLabel: use.editionLabel,
      applicability: use.applicability,
      sourceUrl: use.sourceUrl && /^https?:\/\//.test(use.sourceUrl) ? use.sourceUrl : null,
    })),
    factLabels: factLabelsOf(context, labelsOn),
  }
}

/** The law at the project's site, from the context the turn reads. */
export async function projectLawFor(organizationId: string, projectId: string): Promise<ProjectLaw> {
  return lawOf(await contextForPage(organizationId, projectId))
}
