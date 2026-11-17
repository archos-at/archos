import 'server-only'
import { gateNamesLaw, MAX_PROJECT_LAW_USES, type ProjectLaw } from '../wire/project-law'
import { readSetupRecords } from '@/lib/project-intake/setup-records'
import { selectRecord, type StoredRuleset } from '../rulesets/select'
import { calendarDayIn } from '@/lib/format'
import { contextForPage } from './service'
import type { KnowledgeContext } from './wire'

function factLabelsOf(context: KnowledgeContext, records: readonly StoredRuleset[], on: string): Record<string, string> {
  const keys = context.uses.flatMap((use) => [...(use.applicability?.basis ?? []), ...(use.applicability?.open ?? [])])
  if (keys.length === 0) return {}
  const chain = context.chains[context.gate.leaves[0]?.territoryId ?? ''] ?? []
  const selection = selectRecord(records, { purpose: 'fact_definitions', chain, on })
  const body = selection.status === 'found' ? selection.ruleset.values.body : null
  const labels = new Map((body?.kind === 'fact_definitions' ? body.payload.facts : []).map((fact) => [fact.key, fact.label]))
  return Object.fromEntries(keys.map((key) => [key, labels.get(key) ?? key]))
}

export function lawOf(context: KnowledgeContext, records: readonly StoredRuleset[], labelsOn: string = calendarDayIn('UTC')): ProjectLaw {
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
    factLabels: factLabelsOf(context, records, labelsOn),
  }
}

export async function projectLawFor(organizationId: string, projectId: string): Promise<ProjectLaw> {
  const [context, records] = await Promise.all([contextForPage(organizationId, projectId), readSetupRecords(organizationId)])
  return lawOf(context, records)
}
