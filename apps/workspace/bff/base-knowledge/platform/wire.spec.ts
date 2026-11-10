import { describe, expect, it } from 'vitest'
import { reviewBodySchema } from './wire'

const REVISION = '00000000-0000-4000-8000-000000000001'

describe('reviewBodySchema', () => {
  it('takes one decision per claim', () => {
    expect(reviewBodySchema.safeParse({ decisions: [{ revisionId: REVISION, claimPath: 'name', decision: 'accepted' }] }).success).toBe(true)
  })

  it('refuses two decisions on one claim in one body', () => {
    const result = reviewBodySchema.safeParse({
      decisions: [
        { revisionId: REVISION, claimPath: 'name', decision: 'accepted' },
        { revisionId: REVISION, claimPath: 'name', decision: 'rejected' },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/one decision per review/)
  })
})
