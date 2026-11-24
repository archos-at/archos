import { beforeEach, describe, expect, it, vi } from 'vitest'

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'last_place' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}))
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`redirect:${to}`) }))
vi.mock('next/navigation', () => ({ redirect }))

import AppIndexPage from './page'

beforeEach(() => {
  cookieValue.current = undefined
  redirect.mockClear()
})

describe('/app', () => {
  it('opens Persönlich > Neuer Chat for someone who has not been anywhere yet', async () => {
    await expect(AppIndexPage()).rejects.toThrow('redirect:/app/personal/chat?new=1')
  })

  it('opens a new chat in the project the shell last recorded', async () => {
    cookieValue.current = encodeURIComponent('/app/projects/p1/files')
    await expect(AppIndexPage()).rejects.toThrow('redirect:/app/projects/p1/chat?new=1')
  })
})
