/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

vi.mock('server-only', () => ({}))

const captured: Array<{ sql: string; params: unknown[] }> = []
let answered: unknown[][] = []

const proxyDb = drizzle(async (sql, params) => {
  captured.push({ sql, params })
  return { rows: answered }
})

vi.mock('@/lib/db', () => ({ getDb: () => proxyDb }))

import { findPermitDocument } from './repository'

const DRAFT = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
const SUBMISSION = '5a0d2e3f-4c5b-4d6e-9f70-8b9cad1e2f30'
const row = (id: string) => [id, 'p1', 'proj_c', 'Bescheid.pdf']

beforeEach(() => {
  captured.length = 0
  answered = []
})

describe('findPermitDocument', () => {
  it('refuses a name two live documents of the collection carry as ambiguous, rather than taking the first', async () => {
    answered = [row(DRAFT), row(SUBMISSION)]

    await expect(findPermitDocument('org-1', { collectionName: 'proj_c', fileName: 'Bescheid.pdf' })).rejects.toMatchObject({
      status: 409,
      details: { reason: 'ambiguous_name' },
    })
    expect(captured[0].sql).toContain('"documents"."lifecycle" = ')
    expect(captured[0].params.at(-1)).toBe(2)
  })

  it('finds the one live document a name names', async () => {
    answered = [row(DRAFT)]

    await expect(findPermitDocument('org-1', { collectionName: 'proj_c', fileName: 'Bescheid.pdf' })).resolves.toMatchObject({
      documentId: DRAFT,
      projectId: 'p1',
    })
  })

  it('prefers the id: it asks for that document alone, whatever its name', async () => {
    answered = [row(SUBMISSION)]

    await expect(
      findPermitDocument('org-1', { collectionName: 'proj_c', documentId: SUBMISSION, fileName: 'Bescheid.pdf' })
    ).resolves.toMatchObject({ documentId: SUBMISSION })
    expect(captured[0].sql).toContain('"documents"."id" = ')
    expect(captured[0].sql).not.toContain('"documents"."filename" = ')
    expect(captured[0].params.at(-1)).toBe(1)
  })
})
