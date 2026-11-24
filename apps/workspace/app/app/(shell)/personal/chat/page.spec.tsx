import { beforeEach, describe, expect, test, vi } from 'vitest'

const elsewhere = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`) }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/session', () => ({
  getUserSession: async () => ({ organizationId: 'org-1', organizationMembershipId: 'm-1', userId: 'u-1' }),
}))
vi.mock('@/lib/authz/feature-flags', () => ({ isCollaborationEnabled: () => true }))
vi.mock('@/lib/conversations/chat-route', () => ({ chatRouteElsewhere: elsewhere }))
vi.mock('@/lib/db/tenant-context', () => ({ runWithTenantSlot: (fn: () => unknown) => fn() }))
vi.mock('./personal-chat-client', () => ({ PersonalChatClient: () => null }))

import PersonalChatPage from './page'

beforeEach(() => {
  elsewhere.mockReset()
  redirect.mockClear()
})

describe('the personal chat page renders only a personal chat', () => {
  test('a project’s chat named by ?session= is sent to its own project before anything renders', async () => {
    elsewhere.mockResolvedValue('/app/projects/p1/chat?session=s_holz')

    await expect(PersonalChatPage({ searchParams: Promise.resolve({ session: 's_holz' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(elsewhere).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }), 's_holz', null)
    expect(redirect).toHaveBeenCalledWith('/app/projects/p1/chat?session=s_holz')
  })

  test('its own chat, or none, renders', async () => {
    elsewhere.mockResolvedValue(null)
    await expect(PersonalChatPage({ searchParams: Promise.resolve({ session: 's_me' }) })).resolves.toBeTruthy()
    await expect(PersonalChatPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
