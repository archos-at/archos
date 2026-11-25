import { describe, expect, it } from 'vitest'
import { parseShelfChannelId, shelfChannelKey, shelfTopic } from './shelf-live-events'

describe('the live channel of a personal shelf', () => {
  it('round-trips its owner, and its topic names the owner', () => {
    const shelf = { kind: 'personal', userId: 'user_01ABC' } as const
    expect(shelfChannelKey(shelf)).toBe('shelf:personal-user_01ABC')
    expect(parseShelfChannelId('personal-user_01ABC')).toEqual(shelf)
    expect(shelfTopic('org-1', shelf)).toBe('rt:shelf:org-1:personal:user_01ABC')
  })

  it('refuses an id that is not one', () => {
    expect(parseShelfChannelId('personal-')).toBeNull()
    expect(parseShelfChannelId('personal-a b')).toBeNull()
  })
})
