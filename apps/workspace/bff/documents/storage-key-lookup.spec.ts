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
          return { orderBy: () => ({ limit: () => Promise.resolve([]) }) }
        },
      }),
    }),
  }),
}))

vi.mock('@/lib/db/tenant-context', () => ({
  withOptionalTenant: (_org: string | undefined, _why: string, fn: () => unknown) => fn(),
  withTenant: (_scope: unknown, fn: () => unknown) => fn(),
}))

import { findStorageKeyByCollectionAndFilename } from './repository'
import { documentVisibleTo, SCREENED_ONLY } from './visibility'

const render = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL)

const occurrences = (text: string, needle: string) => text.split(needle).length - 1

describe('findStorageKeyByCollectionAndFilename', () => {
  beforeEach(() => whereArg.mockReset())

  it('puts the authorship predicate in the query, not in a later filter', async () => {
    await findStorageKeyByCollectionAndFilename('proj_abc', 'brandschutz-2026-08-20.pdf')

    expect(whereArg).toHaveBeenCalledTimes(1)
    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.sql).toContain('"documents"."collection_name" = ')
    expect(query.sql).toContain('"documents"."filename" = ')
    expect(query.params).toEqual(expect.arrayContaining(['proj_abc', 'brandschutz-2026-08-20.pdf', 'user']))
  })

  it('never resolves a quarantined document, whose bytes no model may read (ADR-0086)', async () => {
    await findStorageKeyByCollectionAndFilename('proj_abc', 'konten.pdf')

    expect(render(whereArg.mock.calls[0][0]).params).toContain('quarantined')
  })

  it('still narrows by organization when the caller can supply one', async () => {
    await findStorageKeyByCollectionAndFilename('archiv_org-1', 'plan.pdf', 'org-1')

    const query = render(whereArg.mock.calls[0][0])
    expect(query.sql).toContain('"documents"."organization_id" = ')
    expect(query.sql).toContain('"documents"."authored_by" = ')
    expect(query.params).toEqual(expect.arrayContaining(['org-1', 'user']))
  })

  it("names 'user' rather than excluding one producer by name", async () => {
    await findStorageKeyByCollectionAndFilename('proj_abc', 'plan.pdf')

    const lookup = render(whereArg.mock.calls[0][0])
    const visibility = render(documentVisibleTo(SCREENED_ONLY))
    expect(lookup.sql).toContain('"documents"."authored_by" = ')
    expect(lookup.params).toContain('user')
    expect(occurrences(lookup.sql, '"documents"."authored_by" <>')).toBe(
      occurrences(visibility.sql, '"documents"."authored_by" <>'),
    )
  })
})
