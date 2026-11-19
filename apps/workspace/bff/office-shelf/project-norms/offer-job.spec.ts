import { describe, expect, it } from 'vitest'
import { normOffersOf, normOfferPayloadSchema } from './offer-job'

describe('the norm offers an upload owes', () => {
  it('owes one per completed project batch and none for the Büroablage', () => {
    const offers = normOffersOf([
      { id: 'b-1', scope: 'project', projectId: 'p-1', createdBy: 'u-1' },
      { id: 'b-2', scope: 'office_shelf', projectId: null, createdBy: 'u-1' },
      { id: 'b-3', scope: 'project', projectId: null, createdBy: 'u-1' },
    ])
    expect(offers).toEqual([{ batchId: 'b-1', projectId: 'p-1', createdBy: 'u-1' }])
    expect(normOfferPayloadSchema.parse(offers[0])).toEqual(offers[0])
  })
})
