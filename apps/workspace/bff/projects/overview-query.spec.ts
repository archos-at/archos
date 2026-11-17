/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@/lib/db'
import { getProjectOverviewData } from './overview-query'
import { memberReader, REVIEWER_READER } from '@/lib/documents/document-reader'

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ORG_ID = 'org_1'
const OPEN = { hiddenFolderIds: [] as string[], reader: REVIEWER_READER }
const HIDDEN_FOLDER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

const projectRow = {
  id: PROJECT_ID,
  name: 'Haus am See',
  collectionName: `proj_${PROJECT_ID}`,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  profile: null,
  profileDisplay: null,
}

let predicates: SQL[] = []

function recordingDb(results: unknown[][]) {
  let next = 0
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: (condition: SQL) => {
      predicates.push(condition)
      return chain
    },
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(results[next++] ?? []).then(resolve, reject),
  }
  return chain as unknown as ReturnType<typeof getDb>
}

const dialect = new PgDialect()

function compile(predicate: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(predicate)
  return { sql: query.sql, params: query.params }
}

describe('getProjectOverviewData', () => {
  beforeEach(() => {
    predicates = []
    vi.mocked(getDb).mockReturnValue(
      recordingDb([[projectRow], [{ count: 0, totalSize: '0' }], []])
    )
  })

  it('counts only documents on the project shelf', async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    const stats = compile(predicates[1])
    expect(stats.sql).toContain('"scope"')
    expect(stats.params).toEqual([PROJECT_ID, ORG_ID, 'project'])
  })

  it('lists only documents on the project shelf', async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    const recent = compile(predicates[2])
    expect(recent.sql).toContain('"scope"')
    expect(recent.params).toEqual([PROJECT_ID, ORG_ID, 'project'])
  })

  it('asks the count and the list the same question', async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    expect(compile(predicates[1])).toEqual(compile(predicates[2]))
  })

  it('still scopes both queries to the project and the organization', async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    for (const predicate of [predicates[1], predicates[2]]) {
      const { sql, params } = compile(predicate)
      expect(sql).toContain('"project_id"')
      expect(sql).toContain('"organization_id"')
      expect(params).toContain(ORG_ID)
    }
  })

  it('leaves a hidden folder out of the count, the total size and the recent list', async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, { hiddenFolderIds: [HIDDEN_FOLDER], reader: REVIEWER_READER })

    for (const predicate of [predicates[1], predicates[2]]) {
      const { sql, params } = compile(predicate)
      expect(sql).toContain('"folder_id" is null')
      expect(sql).toContain('"folder_id" not in')
      expect(params).toContain(HIDDEN_FOLDER)
    }
    expect(compile(predicates[1])).toEqual(compile(predicates[2]))
  })

  it('hands the overview a profile with its four parts when the intake was never saved', async () => {
    vi.mocked(getDb).mockReturnValue(
      recordingDb([[{ ...projectRow, profile: {} }], [{ count: 0, totalSize: '0' }], []])
    )

    const data = await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    expect(data?.profile).toEqual({ facts: {}, goals: {}, unknowns: [], assumptions: {} })
  })

  it('hands the overview the empty profile for a row without one', async () => {
    const data = await getProjectOverviewData(PROJECT_ID, ORG_ID, OPEN)

    expect(data?.profile?.facts).toEqual({})
  })

  it("leaves somebody else's held file out of the count, the total size and the recent list", async () => {
    await getProjectOverviewData(PROJECT_ID, ORG_ID, { hiddenFolderIds: [], reader: memberReader('user-member') })

    for (const predicate of [predicates[1], predicates[2]]) {
      const { sql, params } = compile(predicate)
      expect(sql).toContain('"status" <>')
      expect(sql).toContain('"screening_outcome" in')
      expect(sql).toContain('"created_by" =')
      expect(params).toEqual(expect.arrayContaining(['quarantined', 'clean', 'released', 'completed', 'user-member']))
    }
    expect(compile(predicates[1])).toEqual(compile(predicates[2]))
  })
})
