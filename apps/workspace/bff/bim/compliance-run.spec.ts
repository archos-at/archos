/**
 * @vitest-environment node
 *
 * The rule catalogue over one model reads the knowledge context of the model's
 * project, the one its page and the turn read: a verdict where the rule's
 * edition binds at the site, a hint elsewhere, and a changed basis is a new run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeContext } from '@/lib/base-knowledge/context/wire'
import type { BimModelHeader } from './repository'
import { contextAt, contextUse } from './rule-basis.fixtures'
import type { BimElement } from './types'

const contextForPage = vi.fn<(organizationId: string, projectId: string) => Promise<KnowledgeContext>>()
const loadBimElementsForSchedule = vi.fn<() => Promise<{ elements: BimElement[]; truncated: boolean }>>()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/base-knowledge/context/service', () => ({ contextForPage }))
vi.mock('./repository', () => ({
  loadBimRuleInputs: vi.fn(async () => null),
  saveBimRuleInputs: vi.fn(async () => undefined),
  loadBimElementsForSchedule,
}))

const { complianceRun, contextOfModel } = await import('./compliance-run')
const { clearComplianceCache } = await import('./compliance-cache')

const header = { id: 'model-1', projectId: 'project-1', updatedAt: new Date('2026-11-11T10:00:00Z'), summary: null } as unknown as BimModelHeader
const door = { globalId: 'D1', name: 'D1', ifcType: 'IfcDoor', storeyName: 'EG', properties: {}, quantities: { Qto_DoorBaseQuantities: { Width: 700 } } } as unknown as BimElement
const FACTS = { buildingClass: 3, mainUse: 'residential' }
const doorRule = (run: Awaited<ReturnType<typeof complianceRun>>) => run.compliance.find((rule) => rule.ruleId === 'oib4-door-clear-width')

const VIENNA = contextAt('AT-9', 'core', [contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023')])
const STYRIA = contextAt('AT-6', 'core', [
  contextUse('OIB-Richtlinie 4', 'Ausgabe April 2019', { route: { workId: 'w', designation: 'StBTV', editionLabel: null, provision: null } }),
])

describe('the rule catalogue over one model', () => {
  beforeEach(() => {
    clearComplianceCache()
    contextForPage.mockReset()
    loadBimElementsForSchedule.mockReset()
    loadBimElementsForSchedule.mockResolvedValue({ elements: [door], truncated: false })
  })

  it("reads the context of the model's project, and none for a model in no project", async () => {
    contextForPage.mockResolvedValue(VIENNA)
    expect(await contextOfModel(header, 'org-1')).toBe(VIENNA)
    expect(contextForPage).toHaveBeenCalledWith('org-1', 'project-1')
    expect(await contextOfModel({ ...header, projectId: null }, 'org-1')).toBeNull()
    expect(contextForPage).toHaveBeenCalledTimes(1)
  })

  it('fails a door where the edition binds, and only hints where another edition does: a new basis is a new run', async () => {
    contextForPage.mockResolvedValue(VIENNA)
    expect(doorRule(await complianceRun(header, 'org-1', FACTS))).toMatchObject({ failed: 1 })

    contextForPage.mockResolvedValue(STYRIA)
    const styria = doorRule(await complianceRun(header, 'org-1', FACTS))
    expect(styria).toMatchObject({ failed: 0, undecidable: 1, missing: [] })
    expect(styria?.hint).toBe('Hinweis: Schwellwerte aus Ausgabe Mai 2023; am Standort gilt Ausgabe April 2019 über StBTV')
    expect(loadBimElementsForSchedule).toHaveBeenCalledTimes(2)
  })

  it("judges a base revision at the asking model's site, without reading its own", async () => {
    expect(doorRule(await complianceRun(header, 'org-1', FACTS, STYRIA))).toMatchObject({ failed: 0, undecidable: 1 })
    expect(contextForPage).not.toHaveBeenCalled()
  })
})
