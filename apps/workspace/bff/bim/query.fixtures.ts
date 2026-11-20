import { vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { extractIfcModel } from './extract'
import { completeBimModel, startBimModel } from './extraction-repository'
import { buildSearchKeys } from './rule-inputs'
import type { BimElement, BimModelIndex } from './types'

export const BIG_MODEL_ELEMENTS = 10_100

export interface QueryFixture {
  ORG: string
  OTHER_ORG: string
  modelId: string
  revisionModelId: string
  otherModelId: string
  otherBuildingId: string
  bigModelId: string
  PLACED_PROJECT: string
  FIXTURE_PROJECT: string
  index: BimModelIndex
  elements: BimElement[]
}

type SearchKeys = Record<string, string[]>

const BIG_KINDS = [
  { ifcType: 'IfcDoor', pset: 'Pset_DoorCommon' },
  { ifcType: 'IfcWall', pset: 'Pset_WallCommon' },
  { ifcType: 'IfcWindow', pset: 'Pset_WindowCommon' },
] as const
const BIG_FIRE_RATINGS = ['REI 90', 'EI 30'] as const

function bigElement(i: number): BimElement {
  const kind = BIG_KINDS[i % 3]!
  return {
    globalId: `BIG${String(i).padStart(19, '0')}`,
    expressId: i,
    ifcType: kind.ifcType,
    name: `Bauteil ${i}`,
    description: null,
    predefinedType: null,
    objectType: null,
    tag: null,
    typeName: null,
    containerKind: null,
    containerGlobalId: null,
    containerName: null,
    storeyGlobalId: null,
    storeyName: 'Erdgeschoss',
    materials: [],
    classifications: [],
    properties: { [kind.pset]: { FireRating: BIG_FIRE_RATINGS[i % 2]!, Reference: `R${i}` } },
    quantities: {},
  }
}

export function platform<T extends Record<string, unknown> = Record<string, unknown>>(reason: string, statement: SQL) {
  return withPlatformAccess(reason, () => getDb().execute<T>(statement))
}

export function sortedKeys(keys: SearchKeys): SearchKeys {
  return Object.fromEntries(Object.entries(keys).map(([key, values]) => [key, [...values].sort()]))
}

export async function seedDocument(organizationId: string, filename: string): Promise<string> {
  const rows = await platform<{ id: string }>(
    'seed a BIM fixture document',
    sql`
      INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status)
      VALUES (${organizationId}, 'seed', ${filename}, ${`seed/${filename}`}, 'seed', 'completed')
      RETURNING id
    `
  )
  return Array.from(rows)[0]!.id
}

export async function readSearchKeys(modelId: string): Promise<Record<string, SearchKeys>> {
  const rows = await platform<{ global_id: string; search_keys: SearchKeys | null }>(
    'read the search keys',
    sql`SELECT global_id, search_keys FROM bim_elements WHERE model_id = ${modelId}::uuid`
  )
  return Object.fromEntries(Array.from(rows).map((row) => [row.global_id, sortedKeys(row.search_keys ?? {})]))
}

export async function writeSearchKeys(modelId: string, elements: readonly BimElement[]): Promise<void> {
  const rows = elements.map((element) => ({ global_id: element.globalId, search_keys: buildSearchKeys(element) }))
  await platform(
    'restore the search keys the extractor writes',
    sql`
      UPDATE bim_elements e
      SET search_keys = r.search_keys
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(global_id text, search_keys jsonb)
      WHERE e.model_id = ${modelId}::uuid AND e.global_id = r.global_id
    `
  )
}

export async function clearSearchKeys(modelId: string): Promise<void> {
  await platform('clear the search keys', sql`UPDATE bim_elements SET search_keys = NULL WHERE model_id = ${modelId}::uuid`)
}

export async function setSearchKeysIndexed(modelId: string, value: boolean): Promise<void> {
  await platform('set the search-key flag', sql`UPDATE bim_models SET search_keys_indexed = ${value} WHERE id = ${modelId}::uuid`)
}

export async function seedQueryFixture(): Promise<QueryFixture> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is unset, so the BIM query fixture has no Postgres to seed')
  vi.stubEnv('APP_DATABASE_URL', url)

  const ORG = `org_bim_${randomUUID()}`
  const OTHER_ORG = `org_bim_other_${randomUUID()}`

  const buffer = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'ifc', 'sample-building.ifc'))
  const index = await extractIfcModel(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    'sample-building.ifc'
  )

  const { elements: extracted, ...summary } = index
  const elements = extracted.map((element, position) =>
    position === 0
      ? {
          ...element,
          properties: {
            ...element.properties,
            Pset_WallCommon: { ...element.properties.Pset_WallCommon, AcousticRating: null },
          },
        }
      : element
  )
  const placedRows = await platform<{ id: string }>(
    'seed a BIM project placed in Austria',
    sql`
      INSERT INTO projects (organization_id, name, created_by, collection_name, profile)
      VALUES (${ORG}, 'BIM fixture in Vienna', 'seed', 'seed', ${JSON.stringify({
        facts: {
          country: { value: 'at', confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-11-10T00:00:00Z' },
          federal_state: { value: 'vienna', confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-11-10T00:00:00Z' },
        },
        goals: {},
        unknowns: [],
        assumptions: {},
      })}::jsonb)
      RETURNING id
    `
  )
  const PLACED_PROJECT = Array.from(placedRows)[0]!.id
  const documentId = await seedDocument(ORG, 'sample-building.ifc')
  const modelIdRun = await startBimModel({ organizationId: ORG, projectId: PLACED_PROJECT, documentId })
  const modelId = modelIdRun.modelId
  await completeBimModel({
    run: modelIdRun,
    organizationId: ORG,
    summary,
    elements,
    indexStorageKey: null,
    indexStorageBucket: null,
  })

  const revisionElements = elements
    .filter((element) => element.name !== 'Innenwand OG')
    .map((element) =>
      element.name === 'Aussenwand Nord'
        ? {
            ...element,
            properties: {
              ...element.properties,
              Pset_WallCommon: { ...element.properties.Pset_WallCommon, FireRating: 'REI 30' },
            },
          }
        : element
    )
    .concat([
      {
        ...elements[0]!,
        globalId: '0GridFixture00Door0009',
        expressId: 9001,
        ifcType: 'IfcDoor',
        name: 'Fluchttuer OG',
        storeyName: 'Obergeschoss',
        storeyGlobalId: '0GridFixture00StoreyOG',
        properties: {},
        quantities: {},
        materials: [],
        classifications: [],
        typeName: null,
        predefinedType: null,
        tag: null,
      },
    ])
  const revisionDocumentId = await seedDocument(ORG, 'sample-building-v2.ifc')
  const revisionRun = await startBimModel({ organizationId: ORG, projectId: PLACED_PROJECT, documentId: revisionDocumentId })
  const revisionModelId = revisionRun.modelId
  await completeBimModel({
    run: revisionRun,
    organizationId: ORG,
    summary,
    elements: revisionElements,
    indexStorageKey: null,
    indexStorageBucket: null,
  })

  const otherBuildingDocumentId = await seedDocument(ORG, 'nebengebaeude.ifc')
  const otherBuildingRun = await startBimModel({ organizationId: ORG, projectId: null, documentId: otherBuildingDocumentId })
  const otherBuildingId = otherBuildingRun.modelId
  await completeBimModel({
    run: otherBuildingRun,
    organizationId: ORG,
    summary,
    elements,
    indexStorageKey: null,
    indexStorageBucket: null,
  })

  const projectRows = await platform<{ id: string }>(
    'seed a BIM fixture project',
    sql`
      INSERT INTO projects (organization_id, name, created_by, collection_name)
      VALUES (${ORG}, 'BIM fixture', 'seed', 'seed')
      RETURNING id
    `
  )
  const FIXTURE_PROJECT = Array.from(projectRows)[0]!.id

  const otherDocumentId = await seedDocument(OTHER_ORG, 'other.ifc')
  const otherModelRun = await startBimModel({ organizationId: OTHER_ORG, projectId: null, documentId: otherDocumentId })
  const otherModelId = otherModelRun.modelId
  await completeBimModel({
    run: otherModelRun,
    organizationId: OTHER_ORG,
    summary,
    elements,
    indexStorageKey: null,
    indexStorageBucket: null,
  })

  const bigDocumentId = await seedDocument(ORG, 'big-building.ifc')
  const bigRun = await startBimModel({ organizationId: ORG, projectId: null, documentId: bigDocumentId })
  const bigModelId = bigRun.modelId
  await completeBimModel({
    run: bigRun,
    organizationId: ORG,
    summary,
    elements: [],
    indexStorageKey: null,
    indexStorageBucket: null,
  })
  const bigRows = Array.from({ length: BIG_MODEL_ELEMENTS }, (_, n) => bigElement(n + 1)).map((element) => ({
    global_id: element.globalId,
    express_id: element.expressId,
    ifc_type: element.ifcType,
    name: element.name,
    storey_name: element.storeyName,
    properties: element.properties,
    quantities: element.quantities,
    search_keys: buildSearchKeys(element),
  }))
  await platform(
    'seed a large BIM fixture',
    sql`
      INSERT INTO bim_elements
        (model_id, global_id, express_id, ifc_type, name, storey_name, properties, quantities, search_keys)
      SELECT ${bigModelId}::uuid, r.global_id, r.express_id, r.ifc_type, r.name, r.storey_name,
        r.properties, r.quantities, r.search_keys
      FROM jsonb_to_recordset(${JSON.stringify(bigRows)}::jsonb) AS r(
        global_id text, express_id integer, ifc_type text, name text, storey_name text,
        properties jsonb, quantities jsonb, search_keys jsonb
      )
    `
  )
  await platform(
    'record the large fixture element count',
    sql`UPDATE bim_models SET element_count = ${BIG_MODEL_ELEMENTS} WHERE id = ${bigModelId}::uuid`
  )
  await platform('drop the empty rule-input projection', sql`UPDATE bim_models SET rule_inputs = NULL WHERE id = ${bigModelId}::uuid`)

  return {
    ORG,
    OTHER_ORG,
    modelId,
    revisionModelId,
    otherModelId,
    otherBuildingId,
    bigModelId,
    PLACED_PROJECT,
    FIXTURE_PROJECT,
    index,
    elements,
  }
}
