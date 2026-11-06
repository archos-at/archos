/**
 * @vitest-environment node
 */
/**
 * The compliance memo across a same-name re-upload.
 *
 * A re-upload keeps the document id (`shelf-upload.ts`), and `startBimModel`
 * upserts on the document, so the corrected file is judged under the SAME model
 * id. A memo keyed on that id alone keeps reporting the previous file's verdicts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearComplianceCache } from './compliance-cache'
import type { BimModelHeader } from './repository'
import { buildStoredRuleInputs } from './rule-inputs'
import type { BimElement, BimModelSummary } from './types'

vi.mock('server-only', () => ({}))

const repository = vi.hoisted(() => ({
  findBimModelById: vi.fn(),
  loadBimRuleInputs: vi.fn(),
  loadBimElementsForSchedule: vi.fn(),
  saveBimRuleInputs: vi.fn(),
}))
vi.mock('./repository', () => repository)

const { bimQuerySchema, runBimQuery } = await import('./query')

const MODEL_ID = '11111111-1111-4111-8111-111111111111'
const ORG = 'org-memo'

const wall = (fireRating: string): BimElement => ({
  globalId: 'wall-1',
  expressId: 1,
  ifcType: 'IfcWall',
  name: 'Aussenwand Nord',
  description: null,
  predefinedType: null,
  objectType: null,
  tag: null,
  typeName: null,
  containerKind: 'storey',
  containerGlobalId: null,
  containerName: 'Erdgeschoss',
  storeyGlobalId: 's-eg',
  storeyName: 'Erdgeschoss',
  materials: [],
  classifications: [],
  properties: { Pset_WallCommon: { LoadBearing: true, FireRating: fireRating } },
  quantities: {},
})

// The storey is what picks the row of OIB 2 Tabelle 1b; without it the rule stands down.
const SUMMARY = {
  storeys: [{ globalId: 's-eg', expressId: 2, name: 'Erdgeschoss', elevation: 0, elementCount: 1 }],
  units: {},
  truncatedAt: null,
  health: null,
} as unknown as BimModelSummary

const header = (updatedAt: string): BimModelHeader => ({
  id: MODEL_ID,
  documentId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  filename: 'haus.ifc',
  displayName: null,
  status: 'ready',
  schemaVersion: 'IFC4',
  elementCount: 1,
  errorMessage: null,
  summary: SUMMARY,
  searchKeysIndexed: true,
  updatedAt: new Date(updatedAt),
})

/** The model as `completeBimModel` leaves it: one write sets both. */
const extracted = (fireRating: string, updatedAt: string): void => {
  repository.findBimModelById.mockResolvedValue(header(updatedAt))
  repository.loadBimRuleInputs.mockResolvedValue(
    buildStoredRuleInputs([wall(fireRating)], false)
  )
}

const fireRule = async () => {
  const result = await runBimQuery(bimQuerySchema.parse({ op: 'compliance', buildingClass: 5 }), {
    modelId: MODEL_ID,
    organizationId: ORG,
  })
  return result.compliance?.find((rule) => rule.ruleId === 'oib2-fire-resistance-load-bearing')
}

describe('the compliance memo across a same-name re-upload', () => {
  beforeEach(() => {
    clearComplianceCache()
    vi.clearAllMocks()
  })

  it('judges the corrected file, not the one it replaced', async () => {
    extracted('REI 90', '2026-11-06T10:00:00.000Z')
    expect(await fireRule()).toMatchObject({ passed: 1, failed: 0 })

    extracted('REI 30', '2026-11-06T10:05:00.000Z')
    expect(await fireRule()).toMatchObject({ passed: 0, failed: 1 })
  })

  it('still answers from the memo while the model has not changed', async () => {
    extracted('REI 90', '2026-11-06T10:00:00.000Z')
    await fireRule()

    extracted('REI 90', '2026-11-06T10:00:00.000Z')
    expect(await fireRule()).toMatchObject({ passed: 1, failed: 0 })
    expect(repository.loadBimRuleInputs).toHaveBeenCalledTimes(1)
  })
})
