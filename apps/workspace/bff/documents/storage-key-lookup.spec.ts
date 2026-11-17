// @disk-inputs: bff/documents/repository/storage.ts
/**
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

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

const columnsIn = (node: unknown, seen = new Set<unknown>()): string[] => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return []
  seen.add(node)
  const here = 'name' in node && typeof (node as { name: unknown }).name === 'string'
    ? [(node as { name: string }).name]
    : []
  return [...here, ...Object.values(node).flatMap((child) => columnsIn(child, seen))]
}

const valuesIn = (node: unknown, seen = new Set<unknown>()): unknown[] => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return []
  seen.add(node)
  const value = (node as { value?: unknown }).value
  const here = typeof value === 'string' ? [value] : []
  return [...here, ...Object.values(node).flatMap((child) => valuesIn(child, seen))]
}

describe('findStorageKeyByCollectionAndFilename', () => {
  beforeEach(() => whereArg.mockReset())

  it('puts the authorship predicate in the query, not in a later filter', async () => {
    await findStorageKeyByCollectionAndFilename('proj_abc', 'brandschutz-2026-08-20.pdf')

    expect(whereArg).toHaveBeenCalledTimes(1)
    const columns = columnsIn(whereArg.mock.calls[0][0])
    expect(columns).toContain('authored_by')
    expect(columns).toContain('collection_name')
    expect(columns).toContain('filename')
  })

  it('never resolves a quarantined document, whose bytes no model may read (ADR-0086)', async () => {
    await findStorageKeyByCollectionAndFilename('proj_abc', 'konten.pdf')

    expect(valuesIn(whereArg.mock.calls[0][0])).toContain('quarantined')
  })

  it('still narrows by organization when the caller can supply one', async () => {
    await findStorageKeyByCollectionAndFilename('archiv_org-1', 'plan.pdf', 'org-1')

    const columns = columnsIn(whereArg.mock.calls[0][0])
    expect(columns).toContain('organization_id')
    expect(columns).toContain('authored_by')
  })

  it("names 'user' rather than excluding one producer by name", () => {
    const source = readFileSync(
      new URL('./repository/storage.ts', import.meta.url),
      'utf8',
    )
    const fn = source.slice(source.indexOf('export async function findStorageKeyByCollectionAndFilename'))
    const body = fn
      .slice(0, fn.indexOf('\n}'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(body).toMatch(/eq\(documents\.authoredBy,\s*'user'\)/)
    expect(body).not.toMatch(/ne\(documents\.authoredBy/)
  })
})
