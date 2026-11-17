/**
 * @vitest-environment node
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeDb } from '@/lib/db'
import { completeBimModel, startBimModel } from './extraction-repository'
import { BimModelNotReadyError, bimQuerySchema, runBimQuery } from './query'
import { loadBimRuleInputs, saveBimRuleInputs } from './repository'
import { platform, seedDocument, seedQueryFixture, type QueryFixture } from './query.fixtures'
import { buildStoredRuleInputs } from './rule-inputs'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('BIM compliance, profile and revision comparison against live Postgres', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('refuses to overwrite a projection written while it was working', async () => {
    const truncationFlag = async (): Promise<boolean | undefined> => {
      const raw = await loadBimRuleInputs(fx.modelId, fx.ORG)
      return raw && typeof raw === 'object' && 'truncated' in raw
        ? Boolean((raw as { truncated: unknown }).truncated)
        : undefined
    }

    const original = await loadBimRuleInputs(fx.modelId, fx.ORG)
    expect(original).not.toBeNull()
    expect(await truncationFlag()).toBe(false)

    await saveBimRuleInputs(fx.modelId, fx.ORG, buildStoredRuleInputs([], true), null)
    expect(await truncationFlag()).toBe(false)

    await saveBimRuleInputs(fx.modelId, fx.ORG, buildStoredRuleInputs([], true), original)
    expect(await truncationFlag()).toBe(true)

    await platform(
      'restore the fixture projection',
      sql`UPDATE bim_models SET rule_inputs = ${JSON.stringify(original)}::jsonb WHERE id = ${fx.modelId}::uuid`
    )
    expect(await truncationFlag()).toBe(false)
  })

  it('runs the OIB rule catalog over the whole element set', async () => {
    const result = await run(bimQuerySchema.parse({ op: 'compliance', buildingClass: 3 }))
    const rules = result.compliance ?? []
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(typeof rule.applicable).toBe('boolean')
      expect(rule.thresholdDe.length).toBeGreaterThan(0)
    }
    const fire = rules.find((rule) => rule.ruleId === 'oib2-fire-resistance-load-bearing')
    expect(fire?.applicable).toBe(true)
    expect((fire?.passed ?? 0) + (fire?.failed ?? 0)).toBeGreaterThan(0)
    expect(result.summary).toContain('keine Rechtsauskunft')
  })

  it('stands a rule down rather than assuming a Gebaeudeklasse it was not given', async () => {
    const result = await run(bimQuerySchema.parse({ op: 'compliance' }))
    const fire = (result.compliance ?? []).find(
      (rule) => rule.ruleId === 'oib2-fire-resistance-load-bearing'
    )
    expect(fire?.applicable).toBe(true)
    expect(fire?.passed).toBe(0)
    expect(fire?.failed).toBe(0)
    expect(fire?.undecidable ?? 0).toBeGreaterThan(0)
    expect(fire?.missing.map((entry) => entry.path)).toContain('Projektangabe: Gebäudeklasse')
  })

  it('derives project facts from the model, each with its evidence', async () => {
    const result = await run({ op: 'profile' })
    const suggestions = result.profileSuggestions ?? []
    const storeys = suggestions.find((entry) => entry.key === 'storeys_above_ground')
    expect(storeys?.value).toBe(2)
    expect(storeys?.evidence).toContain('Erdgeschoss')
    expect(suggestions.find((entry) => entry.key === 'escape_level')?.confidence).toBe('medium')
  })

  it('compares two revisions by GlobalId', async () => {
    const result = await runBimQuery(
      { op: 'compare', baseModelId: fx.modelId, limit: 20_000 },
      { modelId: fx.revisionModelId, organizationId: fx.ORG }
    )
    const comparison = result.comparison
    expect(comparison?.added.map((entry) => entry.name)).toEqual(['Fluchttuer OG'])
    expect(comparison?.removed.map((entry) => entry.name)).toEqual(['Innenwand OG'])
    expect(comparison?.changed).toHaveLength(1)
    expect(comparison?.changed[0].name).toBe('Aussenwand Nord')
    expect(comparison?.changed[0].changes).toContainEqual({
      field: 'Pset_WallCommon.FireRating',
      before: 'REI 90',
      after: 'REI 30',
      delta: null,
    })
    expect(result.summary).toContain('1 neu, 1 entfallen, 1 geändert')
  })

  it('diffs the requirement status between two revisions', async () => {
    const result = await runBimQuery(
      bimQuerySchema.parse({ op: 'compliance-diff', baseModelId: fx.modelId, buildingClass: 5 }),
      { modelId: fx.revisionModelId, organizationId: fx.ORG }
    )
    const fire = (result.complianceChanges ?? []).find(
      (change) => change.ruleId === 'oib2-fire-resistance-load-bearing'
    )
    expect(fire?.trend).toBe('broken')
    expect(fire?.before.failed).toBeLessThan(fire?.after.failed ?? 0)
    expect(result.comparedWith).toBe('sample-building.ifc')
    expect(result.summary).toContain('neu nicht erfüllt')
  })

  it('reports nothing moved when a revision is compared with itself', async () => {
    const result = await runBimQuery(
      bimQuerySchema.parse({ op: 'compliance-diff', baseModelId: fx.modelId, buildingClass: 5 }),
      { modelId: fx.modelId, organizationId: fx.ORG }
    )
    expect(result.complianceChanges).toEqual([])
    expect(result.summary).toContain('Keine Anforderung')
  })

  it('judges the corrected file after a same-name re-upload, not the memoised one', async () => {
    const { elements, ...summary } = fx.index
    const documentId = await seedDocument(fx.ORG, 'wiederhochgeladen.ifc')
    const extract = async (fireRating: string): Promise<string> => {
      const started = await startBimModel({ organizationId: fx.ORG, projectId: fx.PLACED_PROJECT, documentId })
      await completeBimModel({
        run: started,
        organizationId: fx.ORG,
        summary,
        elements: elements.map((element) =>
          element.name === 'Aussenwand Nord'
            ? {
                ...element,
                properties: {
                  ...element.properties,
                  Pset_WallCommon: { ...element.properties.Pset_WallCommon, FireRating: fireRating },
                },
              }
            : element
        ),
        indexStorageKey: null,
        indexStorageBucket: null,
      })
      return started.modelId
    }
    const failedWalls = async (id: string): Promise<number> => {
      const result = await runBimQuery(bimQuerySchema.parse({ op: 'compliance', buildingClass: 5 }), {
        modelId: id,
        organizationId: fx.ORG,
      })
      const fire = result.compliance?.find((rule) => rule.ruleId === 'oib2-fire-resistance-load-bearing')
      return fire?.failed ?? 0
    }

    const first = await extract('REI 90')
    const before = await failedWalls(first)
    const second = await extract('REI 30')

    expect(second).toBe(first)
    expect(await failedWalls(second)).toBeGreaterThan(before)
  })

  it('refuses a compliance diff against another tenant’s revision', async () => {
    await expect(
      runBimQuery(
        bimQuerySchema.parse({ op: 'compliance-diff', baseModelId: fx.otherModelId }),
        { modelId: fx.modelId, organizationId: fx.ORG }
      )
    ).rejects.toBeInstanceOf(BimModelNotReadyError)
  })
})
