import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

vi.mock('server-only', () => ({}))

function fakeDb(usedBytes: number, versionBytes = 0, rowExists = true) {
  const statements: string[] = []
  const inserted: unknown[] = []
  const updated: unknown[] = []
  const whereArgs: string[] = []

  const tx = {
    execute: vi.fn(async (query: { queryChunks?: unknown[] }) => {
      statements.push(JSON.stringify(query.queryChunks ?? query))
      return []
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (condition: SQL) => {
          whereArgs.push(new PgDialect().sqlToQuery(condition).sql)
          statements.push('SELECT sum')
          return [{ bytes: String(usedBytes), versionBytes: String(versionBytes) }]
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        statements.push('INSERT')
        inserted.push(values)
        return []
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            statements.push('UPDATE')
            if (!rowExists) return []
            updated.push(values)
            return [{ id: 'doc-1' }]
          }),
        })),
      })),
    })),
  }

  return {
    statements,
    inserted,
    updated,
    whereArgs,
    tx,
    db: { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) },
  }
}

const getDb = vi.fn()
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }))
vi.mock('@/lib/db/tenant-context', () => ({
  withPlatformAccess: (_reason: string, fn: () => unknown) => fn(),
}))

import { insertDocumentWithinQuota, replaceDocumentWithinQuota } from './repository'
import { ReplacedDocumentGoneError } from '@/lib/documents/unique-conflicts'
import type { NewDocument } from '@/lib/db/schema/documents'

const row = (fileSize: number): NewDocument =>
  ({ id: 'doc-1', organizationId: 'org-1', fileSize }) as unknown as NewDocument

const next = (fileSize: number) => ({
  storageKey: 'k',
  storageBucket: 'b',
  fileSize,
  contentType: 'application/pdf',
  contentHash: 'sha256:beef',
  folderId: null,
  createdBy: 'user-1',
})

describe('the version overhead is part of the ceiling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts a superseded version against the quota', async () => {
    const fake = fakeDb(5_000, 4_500)
    getDb.mockReturnValue(fake.db)

    await expect(insertDocumentWithinQuota(row(1_000), 10_000)).resolves.toEqual({
      ok: false,
      usedBytes: 9_500,
    })
    expect(fake.inserted).toHaveLength(0)
  })

  it('admits the same upload when there is no version overhead', async () => {
    const fake = fakeDb(5_000, 0)
    getDb.mockReturnValue(fake.db)
    await expect(insertDocumentWithinQuota(row(1_000), 10_000)).resolves.toEqual({ ok: true })
  })

  it('counts it on the REPLACE path too', async () => {
    const fake = fakeDb(2_000, 6_000)
    getDb.mockReturnValue(fake.db)

    await expect(
      replaceDocumentWithinQuota('org-1', 'doc-1', next(3_000), 10_000),
    ).resolves.toEqual({ ok: false, usedBytes: 8_000 })
  })
})

describe('insertDocumentWithinQuota', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes the per-organization lock BEFORE reading the sum', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)

    await insertDocumentWithinQuota(row(1_000), 10_000)

    expect(fake.statements).toHaveLength(3)
    expect(fake.statements[0]).toContain('pg_advisory_xact_lock')
    expect(fake.statements[1]).toBe('SELECT sum')
    expect(fake.statements[2]).toBe('INSERT')
  })

  it('keys the lock on the organization, so tenants do not queue behind each other', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)
    await insertDocumentWithinQuota(row(1), 10)
    expect(fake.statements[0]).toContain('storage_quota:org-1')
  })

  it('inserts inside the transaction, not outside it', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)
    await insertDocumentWithinQuota(row(1), 10)
    expect(fake.tx.insert).toHaveBeenCalled()
    expect(fake.db.transaction).toHaveBeenCalledTimes(1)
  })

  it('admits an upload that exactly fills the quota', async () => {
    const fake = fakeDb(9_000)
    getDb.mockReturnValue(fake.db)
    await expect(insertDocumentWithinQuota(row(1_000), 10_000)).resolves.toEqual({ ok: true })
    expect(fake.inserted).toHaveLength(1)
  })

  it('refuses the upload that would cross it, and inserts nothing', async () => {
    const fake = fakeDb(9_000)
    getDb.mockReturnValue(fake.db)

    await expect(insertDocumentWithinQuota(row(1_001), 10_000)).resolves.toEqual({
      ok: false,
      usedBytes: 9_000,
    })
    expect(fake.inserted).toHaveLength(0)
  })

  it('skips the sum entirely when the organization is unlimited', async () => {
    const fake = fakeDb(999_999)
    getDb.mockReturnValue(fake.db)

    await expect(insertDocumentWithinQuota(row(1_000), null)).resolves.toEqual({ ok: true })
    expect(fake.statements).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      'INSERT',
    ])
  })

  it('treats a row with no recorded size as zero rather than NaN', async () => {
    const fake = fakeDb(10_000)
    getDb.mockReturnValue(fake.db)
    const nullSize = { id: 'doc-1', organizationId: 'org-1' } as unknown as NewDocument
    await expect(insertDocumentWithinQuota(nullSize, 10_000)).resolves.toEqual({ ok: true })
  })
})


describe('replaceDocumentWithinQuota', () => {
  beforeEach(() => vi.clearAllMocks())

  it('takes the same per-organization lock BEFORE reading the sum', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)

    await replaceDocumentWithinQuota('org-1', 'doc-1', next(1_000), 10_000)

    expect(fake.statements).toHaveLength(3)
    expect(fake.statements[0]).toContain('pg_advisory_xact_lock')
    expect(fake.statements[1]).toBe('SELECT sum')
    expect(fake.statements[2]).toBe('UPDATE')
  })

  it('shares the lock key with the insert path, so the two serialize against each other', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)

    await replaceDocumentWithinQuota('org-1', 'doc-1', next(1), 10)
    const replaceLock = fake.statements[0]

    const other = fakeDb(0)
    getDb.mockReturnValue(other.db)
    await insertDocumentWithinQuota(row(1), 10)

    expect(replaceLock).toBe(other.statements[0])
  })

  it('charges the FULL new size, because the replaced bytes stay as the superseded version', async () => {
    const fake = fakeDb(9_000)
    getDb.mockReturnValue(fake.db)

    await expect(
      replaceDocumentWithinQuota('org-1', 'doc-1', next(9_500), 10_000)
    ).resolves.toEqual({ ok: false, usedBytes: 9_000 })
    expect(fake.updated).toHaveLength(0)
  })

  it('measures the whole organization, the row being replaced included', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)
    await replaceDocumentWithinQuota('org-1', 'doc-1', next(1), 10)
    expect(fake.whereArgs).toHaveLength(1)
    expect(fake.whereArgs[0]).not.toMatch(/"id" <>/)
    expect(fake.whereArgs[0]).toMatch(/"organization_id" = \$1/)
  })

  it('still refuses a replacement that genuinely does not fit', async () => {
    const fake = fakeDb(9_000)
    getDb.mockReturnValue(fake.db)

    await expect(
      replaceDocumentWithinQuota('org-1', 'doc-1', next(2_000), 10_000)
    ).resolves.toEqual({ ok: false, usedBytes: 9_000 })
    expect(fake.updated).toHaveLength(0)
  })

  it('skips the sum entirely when the organization has no quota', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)

    await replaceDocumentWithinQuota('org-1', 'doc-1', next(1), null)

    expect(fake.statements).toEqual([expect.stringContaining('pg_advisory_xact_lock'), 'UPDATE'])
  })

  it('reports a row deleted since the caller probed it, instead of admitting nothing', async () => {
    const fake = fakeDb(0, 0, false)
    getDb.mockReturnValue(fake.db)

    const outcome = replaceDocumentWithinQuota('org-1', 'doc-1', next(1), 10)

    await expect(outcome).rejects.toBeInstanceOf(ReplacedDocumentGoneError)
    await expect(outcome).rejects.toMatchObject({ status: 409, documentId: 'doc-1' })
  })

  it('updates inside the transaction, not outside it', async () => {
    const fake = fakeDb(0)
    getDb.mockReturnValue(fake.db)
    await replaceDocumentWithinQuota('org-1', 'doc-1', next(1), 10)
    expect(fake.tx.update).toHaveBeenCalled()
    expect(fake.db.transaction).toHaveBeenCalledTimes(1)
  })
})
