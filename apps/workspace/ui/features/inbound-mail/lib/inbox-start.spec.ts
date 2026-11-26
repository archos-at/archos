import { describe, expect, it } from 'vitest'
import { START_HINT_UNTIL_RECEIVED, startHintDue } from './inbox-start'

const active = { state: 'active' as const, address: 'project+haus.abcdefgh2345@inbox.example.org', receivedCount: 0 }

describe('startHintDue: the list says how mail gets here', () => {
  it('while an active address has received fewer than five mails', () => {
    expect(startHintDue(active)).toBe(true)
    expect(startHintDue({ ...active, receivedCount: START_HINT_UNTIL_RECEIVED - 1 })).toBe(true)
  })

  it('never once mail flows, without an address, or before the address is read', () => {
    expect(startHintDue({ ...active, receivedCount: START_HINT_UNTIL_RECEIVED })).toBe(false)
    expect(startHintDue({ ...active, state: 'none', address: null })).toBe(false)
    expect(startHintDue(null)).toBe(false)
  })
})
