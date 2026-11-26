/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import { contentKey, documentSearchWhere, type DocumentQuery } from './document-repository'
import type { SearchReach } from './reach'

const reach = {
  organizationId: 'org-1',
  userId: 'user-1',
  scope: { kind: 'all' },
  projects: [{ project: { id: 'p1' }, hiddenFolderIds: [], reviewsQuarantine: false }],
  officeShelf: null,
  folderIds: null,
  screenedOnly: true,
} as unknown as SearchReach

const query = (contentKeys: string[]): DocumentQuery => ({
  filters: {},
  text: { text: 'Brandabschnitt', contentKeys, contentIds: [] },
  citedBy: null,
  citing: null,
})

const render = (where: SQL | undefined) => new PgDialect().sqlToQuery(where as SQL).sql

describe('documentSearchWhere: a passage the index stored without a document id', () => {
  it('matches a row by collection and file name only while no other uploaded document of that collection carries the name', () => {
    const sql = render(documentSearchWhere(reach, query([contentKey('proj_a', 'Plan.pdf')])))

    expect(sql).toContain('chr(31)')
    expect(sql).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM documents AS twin/)
    expect(sql).toContain('twin.filename = "documents"."filename"')
    expect(sql).toContain('twin.id <> "documents"."id"')
  })

  it('asks no such question when every passage names its document', () => {
    expect(render(documentSearchWhere(reach, query([])))).not.toContain('twin')
  })
})
