import { describe, expect, it } from 'vitest'
import type { Conversation } from '../types'
import { ownProjectOf } from './own-project'

const chat = (id: string, projectId: string | null): Conversation =>
  ({ id, userId: 'u', projectId, title: '', messages: [], createdAt: new Date(), updatedAt: new Date() }) as Conversation

describe('ownProjectOf: a chat names its own project, never the page’s (ADR-0193 rule 2)', () => {
  it('names the project of a project chat', () => {
    expect(ownProjectOf({ currentConversation: chat('a', 'p1'), conversations: [] }, 'a')).toBe('p1')
  })

  it('names none for a chat without a project', () => {
    expect(ownProjectOf({ currentConversation: null, conversations: [chat('a', null)] }, 'a')).toBeUndefined()
  })

  it('names none for a chat it does not know, so the server reads the row', () => {
    expect(ownProjectOf({ currentConversation: chat('a', 'p1'), conversations: [] }, 'b')).toBeUndefined()
  })
})
