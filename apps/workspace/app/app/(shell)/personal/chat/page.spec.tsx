import { beforeEach, describe, expect, test, vi } from 'vitest'

const elsewhere = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT ${href}`) }))
const cookieNames = vi.hoisted(() => new Set<string>())
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/headers', () => ({ cookies: async () => ({ has: (name: string) => cookieNames.has(name) }) }))
vi.mock('@/lib/auth/session', () => ({
  getUserSession: async () => ({ organizationId: 'org-1', organizationMembershipId: 'm-1', userId: 'u-1', name: 'Anna Berger' }),
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

describe('the server tells the personal chat whether it resumes one, so its first paint is the final one', () => {
  const arrivalOf = async (search: Record<string, string>) => {
    elsewhere.mockResolvedValue(null)
    const page = (await PersonalChatPage({ searchParams: Promise.resolve(search) })) as {
      props: { arrival: { resumes: boolean; greetingName: string | null } }
    }
    return page.props.arrival
  }

  beforeEach(() => cookieNames.clear())

  test('no personal chat to resume: the greeting, with the name the server knows', async () => {
    cookieNames.add('chat_resume.p1')
    expect(await arrivalOf({})).toEqual({ resumes: false, greetingName: 'Anna Berger' })
  })

  test('a personal chat to resume: the skeleton', async () => {
    cookieNames.add('chat_resume.personal')
    expect((await arrivalOf({})).resumes).toBe(true)
  })
})
