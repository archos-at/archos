import { describe, expect, it, vi } from 'vitest'

const redirect = vi.fn((to: string) => {
  throw new Error(`redirect ${to}`)
})
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))

import ProjectsPage from './page'

const land = (search: { new?: string } = {}) => ProjectsPage({ searchParams: Promise.resolve(search) }).catch(() => undefined)

describe('/app/projects, kept for bookmarks and redirects, lands where /app does with the overview open', () => {
  it('asks for the overview', async () => {
    await land()
    expect(redirect).toHaveBeenLastCalledWith('/app?overview=1')
  })

  it('asks for it with create open for ?new=1', async () => {
    await land({ new: '1' })
    expect(redirect).toHaveBeenLastCalledWith('/app?overview=new')
  })
})
