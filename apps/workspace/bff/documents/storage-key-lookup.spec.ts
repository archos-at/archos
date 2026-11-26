/**
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const whereArg = vi.fn()

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          whereArg(condition)
          return { orderBy: () => ({ limit: () => Promise.resolve([]) }), limit: () => Promise.resolve([]) }
        },
      }),
    }),
  }),
}))

vi.mock('@/lib/db/tenant-context', () => ({
  withOptionalTenant: (_org: string | undefined, _why: string, fn: () => unknown) => fn(),
  withTenant: (_scope: unknown, fn: () => unknown) => fn(),
}))

import { findReadableStorageKeyById, findStorageKeysByCollectionAndFilename, listDocumentIdsInCollection } from './repository'
import { documentVisibleTo, SCREENED_ONLY } from './visibility'

const render = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL)

const occurrences = (text: string, needle: string) => text.split(needle).length - 1

describe('findStorageKeysByCollectionAndFilename', () => {
  beforeEach(() => whereArg.mockReset())

  it('puts the authorship predicate in the query, not in a later filter', async () => {
    await findStorageKeysByCollectionAndFilename('proj_abc', 'brandschutz-2026-08-20.pdf')

    expect(whereArg).toHaveBeenCalledTimes(1)
    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.sql).toContain('"documents"."collection_name" = ')
    expect(query.sql).toContain('"documents"."filename" = ')
    expect(query.params).toEqual(expect.arrayContaining(['proj_abc', 'brandschutz-2026-08-20.pdf', 'user']))
  })

  it('asks only the live documents of the name, so an archived or binned twin in another folder does not make it ambiguous', async () => {
    await findStorageKeysByCollectionAndFilename('proj_abc', 'Plan.pdf')

    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."lifecycle" = ')
    expect(query.params).toContain('active')
    expect(query.sql).toContain('bin_folder.deleted_at IS NOT NULL')
  })

  it('never resolves a quarantined document, whose bytes no model may read (ADR-0086)', async () => {
    await findStorageKeysByCollectionAndFilename('proj_abc', 'konten.pdf')

    expect(render(whereArg.mock.calls[0][0]).params).toContain('quarantined')
  })

  it('still narrows by organization when the caller can supply one', async () => {
    await findStorageKeysByCollectionAndFilename('archiv_org-1', 'plan.pdf', 'org-1')

    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."organization_id" = ')
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.params).toEqual(expect.arrayContaining(['org-1', 'user']))
  })

  it("names 'user' rather than excluding one producer by name", async () => {
    await findStorageKeysByCollectionAndFilename('proj_abc', 'plan.pdf')

    const lookup = render(whereArg.mock.calls[0][0])
    const visibility = render(documentVisibleTo(SCREENED_ONLY))
    expect(lookup.sql).toContain('"documents"."authored_by" = ')
    expect(lookup.params).toContain('user')
    expect(occurrences(lookup.sql, '"documents"."authored_by" <>')).toBe(
      occurrences(visibility.sql, '"documents"."authored_by" <>'),
    )
  })
})

describe('findReadableStorageKeyById', () => {
  beforeEach(() => whereArg.mockReset())

  it('addresses the row by id inside its collection, as a person-authored, screened document', async () => {
    await findReadableStorageKeyById('4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'proj_abc', 'org-1')

    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."id" = ')
    expect(query.sql).toContain('"documents"."collection_name" = ')
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.sql).toContain('"documents"."organization_id" = ')
    expect(query.sql).not.toContain('"documents"."filename" = ')
    expect(query.params).toEqual(expect.arrayContaining(['4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'proj_abc', 'user', 'org-1', 'quarantined']))
  })
})

describe('listDocumentIdsInCollection', () => {
  beforeEach(() => whereArg.mockReset())

  it('lists the rows that can own chunks: what a person uploaded and what the indexed agent producers filed', async () => {
    await listDocumentIdsInCollection('proj_abc')

    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."collection_name" = ')
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.sql).toContain('"documents"."authored_by_producer" in ')
    expect(query.params).toEqual(expect.arrayContaining(['proj_abc', 'user', 'agent_document', 'agent_file']))
    expect(query.sql).not.toContain('"documents"."organization_id" = ')
  })

  it('narrows by organization when the caller supplies one', async () => {
    await listDocumentIdsInCollection('personal_org-1', 'org-1')

    expect(render(whereArg.mock.calls[0][0]).params).toContain('org-1')
  })
})
