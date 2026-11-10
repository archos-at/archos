// @disk-inputs: ../../packages/knowledge-layer/src/vector_store/scope.py, ../../packages/knowledge-layer/src/vector_store/writes.py, ../../packages/knowledge-layer/tests/test_vector_store_office_filter.py, ../agent-host/src/agent_host/routes/knowledge_mark.py, ../agent-host/tests/test_knowledge_mark_route.py, bff/base-knowledge/chain/chain.integration.spec.ts, bff/base-knowledge/chain/load.ts, bff/base-knowledge/chain/resolve.spec.ts, bff/base-knowledge/chain/resolve.ts, bff/base-knowledge/chain/text.spec.ts, bff/base-knowledge/chain/text.ts, bff/base-knowledge/office/freshness.spec.ts, bff/base-knowledge/office/freshness.ts, bff/base-knowledge/office/service.spec.ts, bff/base-knowledge/office/service.ts, bff/base-knowledge/office/text-use.spec.ts, bff/base-knowledge/office/text-use.ts, bff/base-knowledge/office/turn-block.spec.ts, bff/base-knowledge/office/turn-block.ts, bff/base-knowledge/platform/entitlements.ts, bff/base-knowledge/platform/indexing.ts, bff/base-knowledge/platform/office-read.ts, bff/base-knowledge/platform/platform.integration.spec.ts, bff/base-knowledge/platform/release.ts, bff/base-knowledge/platform/store.ts, bff/base-knowledge/platform/validate.spec.ts, bff/base-knowledge/platform/validate.ts, bff/base-knowledge/store/repository.integration.spec.ts, bff/base-knowledge/store/repository.ts, migrations/0206_country_pack.sql
/**
 * @vitest-environment node
 *
 * The element ledger holds (design §3.10, ADR-0163): every column of the base
 * knowledge tables, every behaviour-bearing value and every payload field has a
 * consumer that names it and a test that exists, or says which later part reads
 * it, and that list only shrinks. A column added without a reader fails here.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  knowledgeChecks,
  knowledgeEditionRevisions,
  knowledgeManifestationRevisions,
  knowledgeRecords,
  knowledgeRevisions,
  knowledgeWorkRevisions,
} from '@/lib/db/schema/knowledge-records'
import {
  knowledgeApprovals,
  knowledgeAuthorityRevisions,
  knowledgeChangeRequests,
  knowledgeIndexRuns,
  knowledgeRelationRevisions,
  knowledgeReleaseMoves,
  knowledgeReviewDecisions,
  knowledgeTerritoryRevisions,
  organizationCountries,
} from '@/lib/db/schema/knowledge-platform'
import { AWAITING_BASELINE, KNOWLEDGE_CONSUMERS } from './consumers'
import { KNOWLEDGE_VOCABULARIES } from './wire/vocab'

const ROOT = join(process.cwd(), '..', '..')
const TABLES: Table[] = [
  knowledgeRecords,
  knowledgeRevisions,
  knowledgeWorkRevisions,
  knowledgeEditionRevisions,
  knowledgeManifestationRevisions,
  knowledgeChecks,
  knowledgeTerritoryRevisions,
  knowledgeAuthorityRevisions,
  knowledgeRelationRevisions,
  knowledgeChangeRequests,
  knowledgeReviewDecisions,
  knowledgeApprovals,
  knowledgeReleaseMoves,
  knowledgeIndexRuns,
  organizationCountries,
]

/** The vocabularies whose values behave differently, so each value needs its own reader. */
const BEHAVIOURAL = ['knowledge_work_revisions.kind', 'knowledge_manifestation_revisions.licence_class'] as const

const columns = (): string[] =>
  TABLES.flatMap((table) => Object.values(getTableColumns(table)).map((column) => `${getTableName(table)}.${column.name}`))

const values = (): string[] =>
  BEHAVIOURAL.flatMap((qualified) => KNOWLEDGE_VOCABULARIES[qualified].map((value) => `${qualified}=${value}`))

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** What a consumer must spell to read an element: the column (snake or camel) or the value. */
function spellings(element: string): string[] {
  const [qualified, value] = element.split('=')
  if (value) return [value]
  const column = qualified.split('.')[1]
  return [column, column.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())]
}

describe('the base knowledge element ledger', () => {
  it('has an entry for every column and every behaviour-bearing value', () => {
    const listed = new Set(KNOWLEDGE_CONSUMERS.map((entry) => entry.element))
    expect([...columns(), ...values()].filter((element) => !listed.has(element))).toEqual([])
  })

  it('lists every element once', () => {
    const elements = KNOWLEDGE_CONSUMERS.map((entry) => entry.element)
    expect(elements.filter((element, index) => elements.indexOf(element) !== index)).toEqual([])
  })

  it.each(KNOWLEDGE_CONSUMERS.filter((entry) => 'consumer' in entry).map((entry) => [entry.element, entry]))(
    '%s is read where the ledger says, and tested',
    (element, entry) => {
      if (!('consumer' in entry)) return
      expect(existsSync(join(ROOT, entry.consumer)), entry.consumer).toBe(true)
      const consumer = read(entry.consumer).toLowerCase()
      expect(spellings(element).some((spelling) => consumer.includes(spelling.toLowerCase())), `${entry.consumer} names ${element}`).toBe(true)
      expect(existsSync(join(ROOT, entry.test.file)), entry.test.file).toBe(true)
      expect(read(entry.test.file), `${entry.test.file} has the test`).toContain(entry.test.name)
    },
  )

  it('only shrinks the elements nothing reads yet, each with the part that will', () => {
    const awaiting = KNOWLEDGE_CONSUMERS.flatMap((entry) => ('awaits' in entry ? [entry] : []))
    for (const entry of awaiting) expect(entry.awaits.length, entry.element).toBeGreaterThan(10)
    expect(awaiting.map((entry) => entry.element).filter((element) => !AWAITING_BASELINE.includes(element))).toEqual([])
    expect(AWAITING_BASELINE.filter((element) => !awaiting.some((entry) => entry.element === element))).toEqual([])
  })
})
