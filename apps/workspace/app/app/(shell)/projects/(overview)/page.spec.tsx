import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../project-overview-sheet', () => ({ ProjectOverviewSheet: vi.fn(() => null) }))
vi.mock('@/i18n/server', () => ({ getTranslations: async () => (key: string) => key }))

import ProjectsPage from './page'
import OverlayPage from '../../@overlay/(.)projects/page'

describe('/app/projects, kept for bookmarks and links, opens the project overview', () => {
  it('as its own page, the create dialog closed', async () => {
    const page = await ProjectsPage({ searchParams: Promise.resolve({}) })
    expect(page.props).toEqual({ standalone: true, autoOpenCreate: false })
  })

  it('with ?new=1 opening the create dialog, as the palette and „Neues Projekt“ ask', async () => {
    const page = await ProjectsPage({ searchParams: Promise.resolve({ new: '1' }) })
    expect(page.props).toEqual({ standalone: true, autoOpenCreate: true })
  })

  it('over the page the person is on, when reached from inside the app', async () => {
    const page = await OverlayPage({ searchParams: Promise.resolve({ new: '1' }) })
    expect(page.props).toEqual({ standalone: false, autoOpenCreate: true })
  })
})
