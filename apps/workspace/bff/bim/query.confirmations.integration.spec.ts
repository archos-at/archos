/**
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { REVIEWER_READER } from '@/lib/documents/document-reader'
import { closeDb } from '@/lib/db'
import { readZipEntries } from '@/test-utils/read-zip'
import { buildComplianceBcf } from './bcf'
import { bimQuerySchema, runBimQuery } from './query'
import { deleteBimCheckConfirmation, listBimCheckConfirmations, upsertBimCheckConfirmation } from './repository'
import { seedQueryFixture, type QueryFixture } from './query.fixtures'
import { attachConfirmations, outstandingRules } from './rules'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', async () => {
  const { settledContext } = await import('./rule-basis.fixtures')
  return { contextForPage: vi.fn(async () => settledContext()) }
})

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('BIM check confirmations and the BCF export against live Postgres', () => {
  let fx: QueryFixture

  beforeAll(async () => {
    fx = await seedQueryFixture()
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  const run = (request: Parameters<typeof runBimQuery>[0]) =>
    runBimQuery(request, { modelId: fx.modelId, organizationId: fx.ORG })

  it('stores a human confirmation against the revision it was made on', async () => {
    await upsertBimCheckConfirmation({
      organizationId: fx.ORG,
      projectId: fx.FIXTURE_PROJECT,
      ruleId: 'oib2-fire-resistance-load-bearing',
      modelId: fx.modelId,
      confirmedBy: 'a.muster',
      note: 'Mit dem Brandschutzplaner abgeklärt.',
    })

    const stored = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    expect(stored).toHaveLength(1)
    expect(stored[0].confirmedBy).toBe('a.muster')

    const confirmations = stored.map((entry) => ({
      ...entry,
      confirmedAt: entry.confirmedAt.toISOString(),
    }))
    const rules = await run(bimQuerySchema.parse({ op: 'compliance', buildingClass: 5 }))

    const current = attachConfirmations(rules.compliance ?? [], confirmations, fx.modelId)
    expect(
      outstandingRules(current).map((rule) => rule.ruleId)
    ).not.toContain('oib2-fire-resistance-load-bearing')

    const later = attachConfirmations(rules.compliance ?? [], confirmations, fx.revisionModelId, [
      fx.modelId,
      fx.revisionModelId,
    ])
    const stale = later.find((rule) => rule.ruleId === 'oib2-fire-resistance-load-bearing')
    expect(stale?.confirmation).not.toBeNull()
    expect(stale?.confirmationStale).toBe(true)
  })

  it('keeps one building’s signature when another building is confirmed', async () => {
    await upsertBimCheckConfirmation({
      organizationId: fx.ORG,
      projectId: fx.FIXTURE_PROJECT,
      ruleId: 'oib2-fire-resistance-load-bearing',
      modelId: fx.otherBuildingId,
      confirmedBy: 'c.nachbar',
      note: 'Nebengebäude, mit dem Brandschutzplaner abgeklärt.',
    })

    const stored = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    const byModel = new Map(stored.map((entry) => [entry.modelId, entry.confirmedBy]))
    expect(byModel.get(fx.modelId)).toBe('a.muster')
    expect(byModel.get(fx.otherBuildingId)).toBe('c.nachbar')
  })

  it('does not show one building’s confirmation on another’s Prüfbuch', async () => {
    const stored = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    const confirmations = stored.map((entry) => ({
      ...entry,
      confirmedAt: entry.confirmedAt.toISOString(),
    }))
    const rules = await run(bimQuerySchema.parse({ op: 'compliance', buildingClass: 5 }))

    const attached = attachConfirmations(rules.compliance ?? [], confirmations, fx.modelId, [
      fx.modelId,
      fx.revisionModelId,
    ])
    const rule = attached.find(
      (entry: { ruleId: string }) => entry.ruleId === 'oib2-fire-resistance-load-bearing'
    )
    expect(rule?.confirmation?.confirmedBy).not.toBe('c.nachbar')
  })

  it('re-confirming the same revision replaces that row rather than adding one', async () => {
    const before = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    await upsertBimCheckConfirmation({
      organizationId: fx.ORG,
      projectId: fx.FIXTURE_PROJECT,
      ruleId: 'oib2-fire-resistance-load-bearing',
      modelId: fx.modelId,
      confirmedBy: 'b.beispiel',
      note: null,
    })
    const stored = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    expect(stored).toHaveLength(before.length)
    expect(stored.find((entry) => entry.modelId === fx.modelId)?.confirmedBy).toBe('b.beispiel')
  })

  it('never shows another tenant’s confirmations', async () => {
    expect(await listBimCheckConfirmations(fx.OTHER_ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)).toEqual([])
  })

  it('withdrawing a confirmation returns the rule to the catalogue’s verdict', async () => {
    await deleteBimCheckConfirmation({
      organizationId: fx.ORG,
      projectId: fx.FIXTURE_PROJECT,
      ruleId: 'oib2-fire-resistance-load-bearing',
      modelIds: [fx.modelId, fx.revisionModelId],
    })
    const left = await listBimCheckConfirmations(fx.ORG, fx.FIXTURE_PROJECT, REVIEWER_READER)
    expect(left.map((entry) => entry.modelId)).toEqual([fx.otherBuildingId])
  })

  it('exports the catalogue’s open items as a BCF an unzip can read', async () => {
    const rules = await run(bimQuerySchema.parse({ op: 'compliance', buildingClass: 5 }))
    const bcf = buildComplianceBcf({
      projectId: fx.FIXTURE_PROJECT,
      projectName: 'Integrationsfixture',
      model: {
        id: fx.modelId,
        filename: 'sample-building.ifc',
        ifcProjectGlobalId: null,
        updatedAt: new Date('2026-05-04T09:30:15.400Z'),
      },
      results: attachConfirmations(rules.compliance ?? [], [], fx.modelId),
      author: 'planer@example.at',
    })

    expect(bcf.topics).toBeGreaterThan(0)
    const archive = readZipEntries(bcf.bytes)
    expect([...archive.keys()][0]).toBe('bcf.version')

    const known = new Set(fx.index.elements.map((element) => element.globalId))
    const selected = [...archive.values()]
      .flatMap((content) => [...content.matchAll(/IfcGuid="([^"]+)"/g)])
      .map((match) => match[1])
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.filter((id) => !known.has(id))).toEqual([])
  })
})
