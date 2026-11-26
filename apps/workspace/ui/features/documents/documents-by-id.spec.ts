import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDocumentsByIdCache, resolveDocumentsById, setDocumentsByIdFetch } from './documents-by-id'
import { isUuidString } from '@/lib/ids'

const PLAN = '3f1c2a7e-9b4d-4c1e-8a2f-5d6e7f809a1b'
const DETAIL = '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d'

function server(rows: Array<{ id: string; filename: string }>) {
  const asked: string[][] = []
  const run = vi.fn(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { scope?: string; ids: string[] }
    if (body.ids.some((id) => !isUuidString(id))) return new Response(null, { status: 400 })
    if (body.scope === 'office_shelf') return Response.json({ documents: [] })
    asked.push(body.ids)
    return Response.json({
      documents: rows.filter((row) => body.ids.includes(row.id)).map((row) => ({ ...row, createdAt: '2026-01-01T00:00:00Z' })),
    })
  })
  setDocumentsByIdFetch(run)
  return { asked }
}

beforeEach(() => resetDocumentsByIdCache())
afterEach(() => {
  resetDocumentsByIdCache()
  setDocumentsByIdFetch()
})

describe('resolveDocumentsById', () => {
  it('never sends an id that is no document id, so one bad id cannot fail the batch', async () => {
    const { asked } = server([
      { id: PLAN, filename: 'Plan.pdf' },
      { id: DETAIL, filename: 'Detail.pdf' },
    ])

    const result = await resolveDocumentsById('proj-1', [PLAN, 'doc:proj_1:plan.pdf', DETAIL, 'Plan.pdf'])

    expect(asked).toEqual([[PLAN, DETAIL]])
    expect(result.get(PLAN)).toMatchObject({ project: { id: PLAN }, error: false })
    expect(result.get(DETAIL)).toMatchObject({ project: { id: DETAIL }, error: false })
    expect(result.get('doc:proj_1:plan.pdf')).toEqual({ project: null, officeShelf: null, error: false })
    expect(result.get('Plan.pdf')).toEqual({ project: null, officeShelf: null, error: false })
  })

  it('knows a document id when it sees one', () => {
    expect(isUuidString(PLAN)).toBe(true)
    expect(isUuidString(PLAN.toUpperCase())).toBe(true)
    expect(isUuidString('doc-1')).toBe(false)
    expect(isUuidString('')).toBe(false)
    expect(isUuidString(null)).toBe(false)
  })
})
