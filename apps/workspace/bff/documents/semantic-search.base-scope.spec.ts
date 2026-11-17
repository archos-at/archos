/**
 * @vitest-environment node
 *
 * The grouped search signs the base corpus's entry with the office's entitled countries (ADR-0173): the
 * agent tier reads a bare base name as a request that says nothing and returns no base chunk.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const signed = vi.hoisted(() => [] as Array<{ collectionScope?: unknown[]; organizationId?: string }>)

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/request-context', () => ({
  buildRequestContextWireHeaders: (input: { collectionScope?: unknown[]; organizationId?: string }) => {
    signed.push(input)
    return {}
  },
}))
vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({
  corpusCountriesFor: vi.fn(async (organizationId: string) => (organizationId === 'org_1' ? ['QA'] : [])),
}))

import { fetchGroupedSemanticHits } from './semantic-search'

beforeEach(() => {
  signed.length = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 })))
})

describe('fetchGroupedSemanticHits and the base corpus', () => {
  it('signs the base entry with the office’s entitled countries and leaves other collections bare', async () => {
    await fetchGroupedSemanticHits('org_1', ['oib_knowledge', 'proj_1'], 'Fluchtweg', 3)

    expect(signed[0].collectionScope).toEqual([
      { collection: 'oib_knowledge', shelf: 'base', countries: ['QA'] },
      'proj_1',
    ])
  })

  it('signs an empty country list for an office entitled to none, so no other country’s text is read', async () => {
    await fetchGroupedSemanticHits('org_2', ['oib_knowledge'], 'Fluchtweg', 3)

    expect(signed[0].collectionScope).toEqual([{ collection: 'oib_knowledge', shelf: 'base', countries: [] }])
  })

  it('signs no base entry when the base is not searched', async () => {
    await fetchGroupedSemanticHits('org_1', ['proj_1'], 'Fluchtweg', 3)

    expect(signed[0].collectionScope).toEqual(['proj_1'])
  })
})
