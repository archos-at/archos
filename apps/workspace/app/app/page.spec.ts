import { beforeEach, describe, expect, it, vi } from 'vitest'

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'last_place' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}))
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`redirect:${to}`) }))
vi.mock('next/navigation', () => ({ redirect }))
const reach = vi.hoisted(() => ({ project: true as boolean, access: true as boolean, session: true as boolean }))
vi.mock('@/lib/auth/require-auth', async () => {
  const { SessionRequiredError } = await import('@/lib/api/errors')
  return {
    withPageSession: async <T,>(fn: (session: { organizationId: string }) => Promise<T>) => {
      if (!reach.session) throw new SessionRequiredError()
      return fn({ organizationId: 'org-1' })
    },
  }
})
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(async () => {
    if (!reach.access) throw new Error('forbidden')
  }),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn(async (id: string) => (reach.project ? { id } : null)),
}))

import AppIndexPage from './page'

const NO_ASK = { searchParams: Promise.resolve({}) }
const asking = (overview: string) => ({ searchParams: Promise.resolve({ overview }) })

beforeEach(() => {
  cookieValue.current = undefined
  reach.project = true
  reach.access = true
  reach.session = true
  redirect.mockClear()
})

describe('/app', () => {
  it('opens Persönlich > Neuer Chat for someone who has not been anywhere yet', async () => {
    await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/personal/chat?new=1')
  })

  it('opens a new chat in the project the shell last recorded', async () => {
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/projects/p1/chat?new=1')
  })

  it('opens a new personal chat when the last project is gone, never the not-found page it would loop on', async () => {
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    reach.project = false
    await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/personal/chat?new=1')
  })

  it('opens a new personal chat when the reader lost access to the last project', async () => {
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    reach.access = false
    await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/personal/chat?new=1')
  })

  it('opens a new personal chat when there is no session, never a 500', async () => {
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    reach.session = false
    await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/personal/chat?new=1')
  })

  it.each(['/app/inbox', '/app/profile', '/app/whats-new', '/app/memory', '/app/organization', '/app/platform'])(
    'never sends a way back from %s to itself: it lands on a new personal chat',
    async (page) => {
      cookieValue.current = encodeURIComponent(page)
      await expect(AppIndexPage(NO_ASK)).rejects.toThrow('redirect:/app/personal/chat?new=1')
    }
  )

  it('carries the ask for the project overview (from /app/projects) to the place it lands on', async () => {
    await expect(AppIndexPage(asking('1'))).rejects.toThrow('redirect:/app/personal/chat?new=1&overview=1')
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    await expect(AppIndexPage(asking('new'))).rejects.toThrow('redirect:/app/projects/p1/chat?new=1&overview=new')
  })
})
