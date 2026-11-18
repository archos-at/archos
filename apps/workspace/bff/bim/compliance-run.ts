import 'server-only'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import type { KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import { readComplianceCache, writeComplianceCache, type CachedCompliance } from './compliance-cache'
import {
  loadBimElementsForSchedule,
  loadBimRuleInputs,
  saveBimRuleInputs,
  type BimModelHeader,
} from './repository'
import { buildStoredRuleInputs, readStoredRuleInputs } from './rule-inputs'
import { basisKey, ruleBases } from './rule-basis'
import { BIM_RULES, missingPropertyShoppingList, runBimRules, summarizeBimRules } from './rules'

export async function contextOfModel(header: BimModelHeader, organizationId: string): Promise<KnowledgeContext | null> {
  return header.projectId ? contextForPage(organizationId, header.projectId) : null
}

export function storeyFacts(
  summary: BimModelHeader['summary']
): Array<{ name: string; elevation: number | null }> | undefined {
  return summary?.storeys.map((storey) => ({
    name: storey.name ?? '',
    elevation: storey.elevation,
  }))
}

export async function complianceRun(
  header: BimModelHeader,
  organizationId: string,
  facts: { buildingClass: number | null; mainUse: string | null },
  given?: KnowledgeContext | null
): Promise<CachedCompliance> {
  const bases = ruleBases(BIM_RULES, given === undefined ? await contextOfModel(header, organizationId) : given)
  const basis = basisKey(bases)
  const cached = readComplianceCache(header, facts.buildingClass, facts.mainUse, basis)
  if (cached) return cached

  const rawRuleInputs = await loadBimRuleInputs(header.id, organizationId)
  const stored = readStoredRuleInputs(rawRuleInputs)
  const loaded = stored
    ? { elements: stored.elements, truncated: stored.truncated }
    : await loadBimElementsForSchedule(header.id, organizationId)

  if (!stored) {
    await saveBimRuleInputs(
      header.id,
      organizationId,
      buildStoredRuleInputs(loaded.elements, loaded.truncated),
      rawRuleInputs
    )
  }

  const truncated = loaded.truncated || header.summary?.truncatedAt != null

  const compliance = runBimRules(loaded.elements, {
    ...facts,
    bases,
    lengthScale: header.summary?.units.length?.siScale ?? null,
    storeys: storeyFacts(header.summary),
  })
  const computed: CachedCompliance = {
    truncated,
    compliance,
    complianceSummary: summarizeBimRules(compliance),
    complianceShoppingList: missingPropertyShoppingList(compliance),
  }
  writeComplianceCache(header, facts.buildingClass, facts.mainUse, basis, computed)
  return computed
}
