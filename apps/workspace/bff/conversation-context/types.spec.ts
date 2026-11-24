/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { isShared } from '@/lib/sharing/access'
import {
  CONTEXT_KINDS,
  isSoloAudience,
  kindOf,
  mayPersonalMemory,
  mayPersonalShelf,
  otherProjectsOf,
  workspaceReadOf,
  type ContextKind,
} from './types'

const OWNER = 'user_owner'
const solo: ConversationAudienceRow = {
  exists: true,
  projectId: null,
  createdBy: OWNER,
  visibility: 'private',
  grantees: [],
  version: 0,
}

describe('isSoloAudience', () => {
  it.each([
    ['a chat that does not exist yet', { ...solo, exists: false, createdBy: null, version: null }, true],
    ['the asker’s private chat', solo, true],
    ['one the asker is also listed on', { ...solo, grantees: [OWNER] }, true],
    ['one shared with a colleague', { ...solo, grantees: ['user_ina'] }, false],
    ['one visible to the project', { ...solo, visibility: 'project' as const }, false],
    ['somebody else’s', { ...solo, createdBy: 'user_ina' }, false],
  ])('%s → %s', (_label, audience, expected) => {
    expect(isSoloAudience(audience, OWNER)).toBe(expected)
  })
})

describe('isShared and solo stay two predicates over one primitive', () => {
  it('a colleague reaching a private chat without a grant: not shared, and not solo for the colleague', () => {
    expect(isShared(solo.visibility, solo.grantees.length)).toBe(false)
    expect(isSoloAudience(solo, 'user_colleague')).toBe(false)
  })

  it('a grant to the owner alone: shared for storage (ADR-0033), solo for the owner', () => {
    expect(isShared('private', 1)).toBe(true)
    expect(isSoloAudience({ ...solo, grantees: [OWNER] }, OWNER)).toBe(true)
  })
})

describe('kindOf', () => {
  it.each([
    ['mcp', 'mcp', undefined, 'external'],
    ['a2a', 'ui', undefined, 'external'],
    ['platform', 'ui', undefined, 'external'],
    [null, 'script', 'chat', 'external'],
    [null, 'ui', undefined, 'chat'],
    [null, 'ui', 'run', 'run'],
    [null, 'ui', 'headless', 'headless'],
  ] as const)('door %s (null: the built-in agent), session %s, started by %s → %s', (door, source, started, kind) => {
    expect(kindOf(door, source, started)).toBe(kind)
  })
})

describe('what each kind may draw on', () => {
  const table: Array<[ContextKind, string | null, boolean, boolean]> = [
    ['chat', 'conv', true, true],
    ['chat', 'conv', false, false],
    ['chat', null, true, false],
    ['run', 'conv', true, true],
    ['run', null, true, false],
    ['headless', 'conv', true, false],
    ['external', 'conv', true, false],
    ['external', null, true, false],
  ]
  it.each(table)('%s in %s, solo %s → personal memory %s', (kind, conversationId, isSolo, expected) => {
    expect(mayPersonalMemory(kind, conversationId, isSolo)).toBe(expected)
  })

  it('never grants anything personal to a run, headless job or external caller without a conversation', () => {
    for (const kind of CONTEXT_KINDS) {
      expect(mayPersonalMemory(kind, null, true)).toBe(false)
      expect(mayPersonalShelf(kind, mayPersonalMemory(kind, null, true), null)).toBe(false)
    }
  })

  it('draws on the personal shelf only in a chat, where personal memory is allowed and the chat has no project', () => {
    expect(mayPersonalShelf('chat', true, null)).toBe(true)
    expect(mayPersonalShelf('chat', true, 'project-1')).toBe(false)
    expect(mayPersonalShelf('chat', false, null)).toBe(false)
  })

  it('never gives a run the personal shelf, even with personal memory in its solo chat: its decision outlives a share', () => {
    expect(mayPersonalMemory('run', 'conv', true)).toBe(true)
    expect(mayPersonalShelf('run', mayPersonalMemory('run', 'conv', true), null)).toBe(false)
  })

  it('reads the workspace fully when solo, only a document or project facts when shared, and not at all headless', () => {
    expect(workspaceReadOf('chat', 'conv', true)).toBe('all')
    expect(workspaceReadOf('chat', 'conv', false)).toBe('document+projectFacts')
    expect(workspaceReadOf('headless', 'conv', true)).toBe('none')
  })

  it('reaches other projects as the asker when solo, as every reader when shared, and not at all headless', () => {
    expect(otherProjectsOf('chat', 'conv', true)).toEqual({ reach: 'chat-projects', restrictedFolders: true })
    expect(otherProjectsOf('chat', 'conv', false)).toEqual({ reach: 'every-reader', restrictedFolders: false })
    expect(otherProjectsOf('run', null, true)).toEqual({ reach: 'none', restrictedFolders: false })
    expect(otherProjectsOf('headless', 'conv', true)).toEqual({ reach: 'none', restrictedFolders: false })
  })
})
