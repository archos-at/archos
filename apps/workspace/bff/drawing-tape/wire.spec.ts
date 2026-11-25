/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isTapeDocument, measurePath, measureRequestSchema, measureResponseSchema } from './wire'

const accepts = (input: unknown) => measureRequestSchema.safeParse(input).success

describe('what the tape asks', () => {
  it.each([
    ['distance', 2, 2],
    ['path', 2, 60],
    ['area', 3, 60],
    ['snap', 1, 60],
  ] as const)('a %s takes %i to %i points', (operation, fewest, most) => {
    const points = (count: number) => Array.from({ length: count }, (_, index) => [index / 100, 0.5])
    expect(accepts({ page: 1, operation, points: points(fewest) })).toBe(true)
    expect(accepts({ page: 1, operation, points: points(most) })).toBe(true)
    expect(accepts({ page: 1, operation, points: points(fewest - 1) })).toBe(false)
    expect(accepts({ page: 1, operation, points: points(most + 1) })).toBe(false)
  })

  it('takes shares of the page from page 1, and nothing else', () => {
    const distance = { page: 1, operation: 'distance', points: [[0.1, 0.1], [0.2, 0.2]] }
    expect(accepts({ ...distance, page: 0 })).toBe(false)
    expect(accepts({ ...distance, points: [[0.1, 0.1], [1.01, 0.2]] })).toBe(false)
    expect(accepts({ ...distance, threshold_min: 1 })).toBe(false)
  })
})

describe('what the engine answers', () => {
  it('reads an unknown code as other, so a newer engine never breaks this build', () => {
    const answer = measureResponseSchema.parse({
      noNumber: { code: 'something_new', reason: 'r', remedy: 'm', scaleState: null, candidates: [] },
    })
    expect(answer).toEqual({ noNumber: { code: 'other', reason: 'r', remedy: 'm', scaleState: null, candidates: [] } })
  })

  it('refuses an answer that is two things at once', () => {
    const snap = { snap: [] }
    const noNumber = { noNumber: { code: 'other', reason: 'r', remedy: 'm', scaleState: null, candidates: [] } }
    expect(measureResponseSchema.safeParse({ ...snap, ...noNumber }).success).toBe(false)
  })
})

describe('which document it reads', () => {
  it('reads a PDF by its file name, and addresses the route by the document’s id', () => {
    expect(isTapeDocument({ filename: 'Grundriss EG.PDF' })).toBe(true)
    expect(isTapeDocument({ filename: 'Lageplan.dxf' })).toBe(false)
    expect(measurePath('a/b')).toBe('/api/documents/a%2Fb/measure')
  })
})
