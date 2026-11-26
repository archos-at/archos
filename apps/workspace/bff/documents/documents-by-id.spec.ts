/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

vi.mock('server-only', () => ({}))

const captured: Array<{ sql: string; params: unknown[] }> = []

const proxyDb = drizzle(async (sql, params) => {
  captured.push({ sql, params })
  return { rows: [] }
})

vi.mock('@/lib/db', () => ({ getDb: () => proxyDb }))
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: (_scope: unknown, fn: () => unknown) => fn(),
}))

import { findDocumentsByIds } from './repository'
import { memberReader } from './document-reader'
import { DOCUMENT_ID_LOOKUP_MAX_IDS } from './id-lookup'

const DRAFT = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
const SUBMISSION = '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30'

beforeEach(() => {
  captured.length = 0
})

describe('findDocumentsByIds', () => {
  it('asks for the ids on the shelf, under the listing predicate and the reader’s visibility', async () => {
    await findDocumentsByIds({ kind: 'project', projectId: 'p1' }, 'org-1', [DRAFT, SUBMISSION], {
      hiddenFolderIds: ['folder-closed'],
      reader: memberReader('user-1'),
    })

    expect(captured).toHaveLength(1)
    const [query] = captured
    expect(query.sql).toMatch(/"documents"\."id" in \(\$\d+, \$\d+\)/)
    expect(query.sql).toContain('"documents"."project_id" = ')
    expect(query.sql).toContain('"documents"."lifecycle" = ')
    expect(query.sql).toContain('"documents"."folder_id"')
    expect(query.sql).toContain('"documents"."screened_hash" IS NOT DISTINCT FROM')
    expect(query.params).toEqual(expect.arrayContaining([DRAFT, SUBMISSION, 'p1', 'org-1', 'folder-closed', 'quarantined']))
  })

  it('asks nothing for a list holding no id, and never sends a value that is not one', async () => {
    expect(await findDocumentsByIds({ kind: 'office_shelf' }, 'org-1', ['Plan.pdf'], { reader: memberReader('user-1') })).toEqual([])
    expect(captured).toHaveLength(0)

    await findDocumentsByIds({ kind: 'office_shelf' }, 'org-1', ['Plan.pdf', DRAFT], { reader: memberReader('user-1') })
    expect(captured[0].params).not.toContain('Plan.pdf')
  })

  it('bounds one ask to the lookup limit', async () => {
    const ids = Array.from({ length: DOCUMENT_ID_LOOKUP_MAX_IDS + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    await findDocumentsByIds({ kind: 'office_shelf' }, 'org-1', ids, { reader: memberReader('user-1') })
    expect(captured[0].params.filter((value) => typeof value === 'string' && value.startsWith('00000000-0000-4000-8000-'))).toHaveLength(
      DOCUMENT_ID_LOOKUP_MAX_IDS,
    )
  })
})
