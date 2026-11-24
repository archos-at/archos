import { beforeEach, describe, expect, test, vi } from 'vitest'

const elsewhere = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`) }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/session', () => ({
  getUserSession: async () => ({ organizationId: 'org-1', organizationMembershipId: 'm-1', userId: 'u-1' }),
}))
vi.mock('@/lib/authz/feature-flags', () => ({ isCollaborationEnabled: () => true }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn(async () => ({})) }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn(async () => ({ name: 'Holzbau Wien' })) }))
vi.mock('@/lib/conversations/chat-route', () => ({ chatRouteElsewhere: elsewhere }))
vi.mock('@/lib/db/tenant-context', () => ({ runWithTenantSlot: (fn: () => unknown) => fn() }))
vi.mock('./project-chat-client', () => ({ ProjectChatClient: () => null }))

import ProjectChatPage from './page'

const open = (session?: string) =>
  ProjectChatPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve(session ? { session } : {}) })

beforeEach(() => {
  elsewhere.mockReset()
  redirect.mockClear()
})

describe('a project’s chat page renders only a chat of that project (the owner’s report from staging, 2026-11-24)', () => {
  test('the personal chat „dere“ named by ?session= is sent to the personal chat, never rendered here', async () => {
    elsewhere.mockResolvedValue('/app/personal/chat?session=s_dere')

    await expect(open('s_dere')).rejects.toThrow('NEXT_REDIRECT')
    expect(elsewhere).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }), 's_dere', 'p1')
    expect(redirect).toHaveBeenCalledWith('/app/personal/chat?session=s_dere')
  })

  test('its own chat, or none, renders', async () => {
    elsewhere.mockResolvedValue(null)
    await expect(open('s_a')).resolves.toBeTruthy()
    await expect(open()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
