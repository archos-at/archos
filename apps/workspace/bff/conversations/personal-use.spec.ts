import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { mayDrawOnPersonal } from './personal-use'
import type { ConversationAudienceRow } from './restricted-use-repository'

const ME = 'u-me'
const row = (overrides: Partial<ConversationAudienceRow> = {}): ConversationAudienceRow => ({
  exists: true,
  projectId: null,
  createdBy: ME,
  visibility: 'private',
  grantees: [],
  ...overrides,
})

describe('a chat draws on its owner’s personal material only without a project and alone (ADR-0191 rules 3 to 5)', () => {
  it('draws on it in the owner’s own chat without a project, and in a first turn before the row exists', () => {
    expect(mayDrawOnPersonal(row(), ME, null)).toBe(true)
    expect(mayDrawOnPersonal({ ...row(), exists: false, createdBy: null }, ME, null)).toBe(true)
  })

  it('never in a project chat, even its owner’s alone, and whatever project the turn names', () => {
    expect(mayDrawOnPersonal(row({ projectId: 'p1' }), ME, null)).toBe(false)
    expect(mayDrawOnPersonal(row(), ME, 'p1')).toBe(false)
  })

  it('never once someone else reads the chat', () => {
    expect(mayDrawOnPersonal(row({ grantees: ['u-colleague'] }), ME, null)).toBe(false)
    expect(mayDrawOnPersonal(row({ visibility: 'project' }), ME, null)).toBe(false)
  })

  it('never for someone who is not the chat’s owner', () => {
    expect(mayDrawOnPersonal(row({ createdBy: 'u-colleague', grantees: [ME] }), ME, null)).toBe(false)
  })
})
