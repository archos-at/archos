/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { RESOURCE_ROLES, type ResourceRole } from '@/lib/db/schema/resource-shares'
import {
  composerCapabilities,
  roleMayContribute,
  type ComposerCapabilityInput,
} from './composer-capabilities'

const PERMITTED: ComposerCapabilityInput = {
  isAuthenticated: true,
  canCollaborate: true,
  sharing: 'private',
  myRole: null,
  isBusy: false,
  isResponseMode: false,
  otherPersonsTurn: false,
}

const withInput = (patch: Partial<ComposerCapabilityInput>) =>
  composerCapabilities({ ...PERMITTED, ...patch })

describe('roleMayContribute', () => {
  test('ranks the ladder rather than matching a name', () => {
    expect(roleMayContribute('viewer')).toBe(false)
    expect(roleMayContribute('collaborator')).toBe(true)
    expect(roleMayContribute('owner')).toBe(true)
  })

  test('no role is not a contributing role', () => {
    expect(roleMayContribute(null)).toBe(false)
  })

  test('a role this client does not recognise is not trusted', () => {
    expect(roleMayContribute('commenter' as ResourceRole)).toBe(false)
  })

  test('the local ladder still matches the server ladder', () => {
    expect([...RESOURCE_ROLES]).toEqual(['viewer', 'collaborator', 'owner'])
  })
})

describe('composerCapabilities', () => {
  test('an idle owner may contribute and compose', () => {
    const caps = withInput({})
    expect(caps).toMatchObject({ canContribute: true, canCompose: true, deniedBy: null })
  })

  test('signed out denies contribution, by name', () => {
    expect(withInput({ isAuthenticated: false })).toMatchObject({
      canContribute: false,
      canCompose: false,
      deniedBy: 'unauthenticated',
    })
  })

  test('a viewer in a shared thread is read-only, by name', () => {
    expect(withInput({ sharing: 'shared', myRole: 'viewer' })).toMatchObject({
      canContribute: false,
      canCompose: false,
      deniedBy: 'read-only-role',
    })
  })

  test('a collaborator in a shared thread keeps everything', () => {
    expect(withInput({ sharing: 'shared', myRole: 'collaborator' })).toMatchObject({
      canContribute: true,
      canCompose: true,
      deniedBy: null,
    })
  })

  describe('a denial of contribution always denies composing', () => {
    for (const patch of [
      { isAuthenticated: false },
      { sharing: 'shared' as const, myRole: 'viewer' as ResourceRole },
    ]) {
      test(JSON.stringify(patch), () => {
        const caps = withInput(patch)
        expect(caps.canContribute).toBe(false)
        expect(caps.canCompose).toBe(false)
      })
    }
  })

  describe('composing is narrower than contributing', () => {
    for (const [label, patch] of [
      ['a turn is running', { isBusy: true }],
      ["somebody else's turn", { otherPersonsTurn: true }],
    ] as const) {
      test(`${label}: may still contribute, may not compose`, () => {
        const caps = withInput(patch)
        expect(caps.canContribute).toBe(true)
        expect(caps.canCompose).toBe(false)
        expect(caps.deniedBy).toBeNull()
      })
    }

    test('response mode reopens the composer during a turn', () => {
      expect(withInput({ isBusy: true, isResponseMode: true }).canCompose).toBe(true)
    })
  })

  describe('drafting during a turn', () => {
    test("the reader's own streaming turn keeps the draft open but not the send", () => {
      const caps = withInput({ isBusy: true, ownTurnStreaming: true })
      expect(caps.canDraft).toBe(true)
      expect(caps.canCompose).toBe(false)
    })

    test('a busy turn the composer was not told is its own stays closed', () => {
      expect(withInput({ isBusy: true }).canDraft).toBe(false)
    })

    test("somebody else's turn keeps the draft closed", () => {
      const caps = withInput({ isBusy: true, ownTurnStreaming: true, otherPersonsTurn: true })
      expect(caps.canDraft).toBe(false)
    })

    test('a read-only role never drafts, own turn or not', () => {
      const caps = withInput({
        sharing: 'shared',
        myRole: 'viewer',
        isBusy: true,
        ownTurnStreaming: true,
      })
      expect(caps.canDraft).toBe(false)
    })

    test('composing implies drafting', () => {
      expect(withInput({}).canDraft).toBe(true)
      expect(withInput({ isBusy: true, isResponseMode: true }).canDraft).toBe(true)
    })
  })

  describe('an unpublished role in a shared thread', () => {
    const caps = withInput({ sharing: 'shared', myRole: null })

    test('is reported as unknown', () => {
      expect(caps.roleUnknown).toBe(true)
    })

    test('CURRENTLY still permits contribution — see the module header', () => {
      expect(caps.canContribute).toBe(true)
      expect(caps.deniedBy).toBeNull()
    })

    test('a private thread with no role is not "unknown"', () => {
      expect(withInput({ sharing: 'private', myRole: null }).roleUnknown).toBe(false)
    })
  })

  describe('typing presence', () => {
    test('is broadcast only in a shared thread by someone who may contribute', () => {
      expect(withInput({ sharing: 'shared', myRole: 'collaborator' }).canBroadcastTyping).toBe(true)
    })

    test('a viewer never announces a draft that cannot become a message', () => {
      expect(withInput({ sharing: 'shared', myRole: 'viewer' }).canBroadcastTyping).toBe(false)
    })

    test('a private thread issues no presence request at all (NF-8)', () => {
      expect(withInput({ sharing: 'private' }).canBroadcastTyping).toBe(false)
    })

    test('collaboration off issues no presence request at all (NF-8)', () => {
      expect(
        withInput({ canCollaborate: false, sharing: 'shared', myRole: 'collaborator' })
          .canBroadcastTyping
      ).toBe(false)
    })
  })
})

describe('project chat permission', () => {
  const base = {
    isAuthenticated: true,
    canCollaborate: false,
    sharing: 'private' as const,
    myRole: null,
    isBusy: false,
    isResponseMode: false,
    otherPersonsTurn: false,
  }

  test('denies, and names the rule', () => {
    const capabilities = composerCapabilities({ ...base, mayChatInProject: false })
    expect(capabilities.canContribute).toBe(false)
    expect(capabilities.canCompose).toBe(false)
    expect(capabilities.deniedBy).toBe('no-project-chat-permission')
  })

  test('permits when omitted — general chat has no project to check', () => {
    expect(composerCapabilities(base).deniedBy).toBeNull()
    expect(composerCapabilities({ ...base, mayChatInProject: true }).deniedBy).toBeNull()
  })

  test('outranks the thread role: it denies a thread OWNER too', () => {
    const capabilities = composerCapabilities({
      ...base,
      canCollaborate: true,
      sharing: 'shared',
      myRole: 'owner',
      mayChatInProject: false,
    })
    expect(capabilities.deniedBy).toBe('no-project-chat-permission')
    expect(capabilities.canBroadcastTyping).toBe(false)
  })

  test('still reports an unauthenticated session as unauthenticated', () => {
    const capabilities = composerCapabilities({
      ...base,
      isAuthenticated: false,
      mayChatInProject: false,
    })
    expect(capabilities.deniedBy).toBe('unauthenticated')
  })
})
