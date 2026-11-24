import { describe, expect, it } from 'vitest'
import { opensHere } from './personal-chat-client'

describe('the personal chat page opens only the person’s own chats without a project (ADR-0193)', () => {
  it('opens one', () => {
    expect(opensHere({ projectId: null, userId: 'u1' }, 'u1')).toBe(true)
  })

  it('leaves a project chat and someone else’s chat to their own place', () => {
    expect(opensHere({ projectId: 'p1', userId: 'u1' }, 'u1')).toBe(false)
    expect(opensHere({ projectId: null, userId: 'u2' }, 'u1')).toBe(false)
  })
})
