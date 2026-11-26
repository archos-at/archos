import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/server', () => ({ getTranslations: async () => (key: string) => key }))

import ProjectsPage, { generateMetadata } from './page'

describe('/app/projects, for a bookmark, a refresh and the links that land there', () => {
  it('leaves the overview to the shell, which opens it over this page (`ProjectOverviewWindow`)', async () => {
    expect(ProjectsPage()).toBeNull()
    expect(await generateMetadata()).toEqual({ title: 'portfolio.title' })
  })
})
