import { describe, expect, it } from 'vitest'
import { corpusQuerySchema, narrowCorpus } from './corpus-query'
import type { KnowledgeBaseStatus, KnowledgeFile } from './service'

const file = (fileName: string, countryId: string | null): KnowledgeFile => ({
  fileName,
  state: 'ingested',
  sizeBytes: 1,
  chunkCount: 1,
  ingestedSha256: null,
  currentSha256: null,
  countryId,
  ingestedAt: null,
  summary: `a long summary of ${fileName}`,
  docClass: 'other',
  docClassSuggestion: null,
  displayTitle: null,
})

const status: KnowledgeBaseStatus = {
  collectionName: 'base',
  collectionExists: true,
  collectionUpdatedAt: null,
  summary: { totalFiles: 4, ingested: 4, stale: 0, pending: 0, failed: 0, removed: 0, inconsistent: 0, totalChunks: 4 },
  files: [file('a-guideline-2019.pdf', 'XA'), file('a-guideline-2023.pdf', 'XA'), file('b-notes.pdf', null), file('c-law.pdf', 'XB')],
}

const narrow = (query: Record<string, string | boolean>) => narrowCorpus(status, corpusQuerySchema.parse(query))

describe('narrowCorpus', () => {
  it('answers the whole store without a query, as the platform page reads it', () => {
    const all = narrow({})
    expect(all.files).toEqual(status.files)
    expect(all).toMatchObject({ matched: 4, nextCursor: null, summary: status.summary })
  })

  it('filters by a part of the name, ignoring case', () => {
    expect(narrow({ nameContains: 'GUIDELINE' }).files.map((f) => f.fileName)).toEqual(['a-guideline-2019.pdf', 'a-guideline-2023.pdf'])
  })

  it('filters by the country a release marked, or by none', () => {
    expect(narrow({ countryId: 'XB' }).files.map((f) => f.fileName)).toEqual(['c-law.pdf'])
    expect(narrow({ countryId: 'none' }).files.map((f) => f.fileName)).toEqual(['b-notes.pdf'])
  })

  it('leaves out the summaries when brief', () => {
    expect(narrow({ brief: 'true' }).files.every((f) => !('summary' in f))).toBe(true)
    expect(narrow({ brief: 'false' }).files[0]).toHaveProperty('summary')
    // An agent sends JSON, so a boolean is the same answer as the query string's text.
    expect(narrow({ brief: true }).files.every((f) => !('summary' in f))).toBe(true)
  })

  it('pages with limit and cursor, and says where the next page starts', () => {
    expect(narrow({ limit: '3' })).toMatchObject({ matched: 4, nextCursor: '3' })
    const last = narrow({ limit: '3', cursor: '3' })
    expect(last.files.map((f) => f.fileName)).toEqual(['c-law.pdf'])
    expect(last.nextCursor).toBeNull()
  })

  it('refuses a country that is no ISO code', () => {
    expect(corpusQuerySchema.safeParse({ countryId: 'Austria' }).success).toBe(false)
  })
})
