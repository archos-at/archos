/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildCollectionScopeHeader, computeCollectionScope, isBaseCorpusCollection } from './collection-scope'

describe('computeCollectionScope', () => {
  it('always includes the base corpus first', () => {
    expect(computeCollectionScope(null, {})).toEqual(['base_corpus'])
  })

  it('injects the org Archiv collection right after the base corpus (ADR-0024)', () => {
    const scope = computeCollectionScope(null, {
      officeShelfCollectionName: 'archiv_org-1',
      projectId: 'p1',
      projectCollectionName: 'proj_p1',
    })
    expect(scope).toEqual(['base_corpus', 'archiv_org-1', 'proj_p1'])
  })

  it('omits the Archiv collection when none is provided (feature off)', () => {
    const scope = computeCollectionScope(null, { projectCollectionName: 'proj_p1' })
    expect(scope).toEqual(['base_corpus', 'proj_p1'])
  })

  it('de-duplicates and round-trips through the header encoding', () => {
    const scope = computeCollectionScope(null, { officeShelfCollectionName: 'archiv_org-1', conversationId: 'c1' })
    expect(scope).toEqual(['base_corpus', 'archiv_org-1', 's_c1'])
    const decoded = JSON.parse(Buffer.from(buildCollectionScopeHeader(scope), 'base64url').toString())
    expect(decoded).toEqual(scope)
  })
})

describe('isBaseCorpusCollection', () => {
  it('knows the base corpus by its name and by the name it had until 2026-11', () => {
    expect(isBaseCorpusCollection('base_corpus')).toBe(true)
    expect(isBaseCorpusCollection('oib_knowledge')).toBe(true)
    expect(isBaseCorpusCollection('proj_p1')).toBe(false)
  })
})
