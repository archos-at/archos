/**
 * The rule catalogue over one model (`complianceRun`), and the project facts it
 * reads beside the elements: the knowledge context of its site, and the model's
 * storeys. Split from `query.ts`, which calls it for `compliance` and `compliance-diff`.
 */

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

/**
 * The knowledge context of the model's project, as the project's page and the
 * turn read it: which editions bind at its site. A model in no project has none,
 * and every rule is then a hint rather than judged by one country's law by default.
 */
export async function contextOfModel(header: BimModelHeader, organizationId: string): Promise<KnowledgeContext | null> {
  return header.projectId ? contextForPage(organizationId, header.projectId) : null
}

/**
 * Storey names and elevations for the rule catalogue.
 *
 * OIB 2 Tabelle 1b asks a different fire-resistance duration of a
 * Kellergeschoß wall than of a ground-floor one; without this a rule cannot
 * tell them apart and has to report the requirement as undetermined.
 */
export function storeyFacts(
  summary: BimModelHeader['summary']
): Array<{ name: string; elevation: number | null }> | undefined {
  return summary?.storeys.map((storey) => ({
    name: storey.name ?? '',
    elevation: storey.elevation,
  }))
}

/**
 * The rule catalogue over one model, through every shortcut there is.
 *
 * Written once because it is needed twice, and the second caller — the
 * revision diff — had none of it: two unconditional `loadBimElementsForSchedule`
 * calls, no projection, no memo, and no truncation flag, so the op that
 * compares two 400 000-element revisions was the slowest thing in the product
 * and the least honest about what it had read.
 *
 * The order matters: memo, then the stored projection, then the full load.
 * Each step is a fact about ONE EXTRACTION — a re-upload keeps the model id but
 * moves `updatedAt` with the elements — so a hit can never describe a building
 * that has since moved.
 */
export async function complianceRun(
  header: BimModelHeader,
  organizationId: string,
  facts: { buildingClass: number | null; mainUse: string | null },
  // A base revision is judged at the site of the model whose project asks, never at its own.
  given?: KnowledgeContext | null
): Promise<CachedCompliance> {
  const bases = ruleBases(BIM_RULES, given === undefined ? await contextOfModel(header, organizationId) : given)
  const basis = basisKey(bases)
  const cached = readComplianceCache(header, facts.buildingClass, facts.mainUse, basis)
  if (cached) return cached

  // The fast path: a single column of a single row, ~120 bytes per element
  // instead of ~1 199, no `jsonb_each`, one parse. See `rule-inputs.ts`.
  const rawRuleInputs = await loadBimRuleInputs(header.id, organizationId)
  const stored = readStoredRuleInputs(rawRuleInputs)
  const loaded = stored
    ? { elements: stored.elements, truncated: stored.truncated }
    : await loadBimElementsForSchedule(header.id, organizationId)

  // Models extracted before the projection existed have none. The first reader
  // pays the old cost once and leaves it behind for everyone else, which is
  // why there is no backfill job.
  if (!stored) {
    // Guarded on what we read: a re-extraction that landed while we were
    // loading elements has already written a NEWER projection, and ours
    // describes the previous revision.
    await saveBimRuleInputs(
      header.id,
      organizationId,
      buildStoredRuleInputs(loaded.elements, loaded.truncated),
      rawRuleInputs
    )
  }

  // TWO caps, and either one makes the run partial: the loader’s, and
  // EXTRACTION’s — elements past `BIM_ELEMENT_LIMIT` were never written to the
  // table at all, so no loader could report them missing. Only the summary
  // knows about that one. A catalogue run over part of a building, reporting
  // verdict counts as though they covered all of it, is what the Prüfbuch, the
  // BCF export and the signed confirmation all inherit.
  const truncated = loaded.truncated || header.summary?.truncatedAt != null

  const compliance = runBimRules(loaded.elements, {
    ...facts,
    bases,
    // The model declares its length unit; a rule that guessed could be wrong
    // by a factor of a thousand. Each revision is judged with ITS OWN, so a
    // re-export from millimetres to metres does not register as every
    // dimension changing by a factor of a thousand.
    lengthScale: header.summary?.units.length?.siScale ?? null,
    // OIB 2 Tabelle 1b asks a different duration of a Kellergeschöß wall than
    // of a ground-floor one; without the elevations no rule can tell. From
    // each side’s OWN summary, for the same reason the length scale is.
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
