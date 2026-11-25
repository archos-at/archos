import { act, fireEvent, render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import Link from 'next/link'
import type { JSX } from 'react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { makeProject } from '@/test-utils/db-fixtures'
import { toOverviewProject } from '@/lib/projects/overview-project'
import { AppShellChrome } from './app-shell-chrome'
import { openProjectOverview, overviewLinkClick, useProjectOverview } from './project-overview-entry'

let pathname = '/app/projects/p1/files'
let search = ''
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push, replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('./app-sidebar', () => ({ AppSidebar: () => <div data-testid="rail" /> }))
vi.mock('./phone-tab-bar', () => ({ PhoneTabBar: () => null }))
vi.mock('./phone-more-sheet', () => ({ PhoneMoreSheet: () => null }))
vi.mock('@/features/onboarding/components/product-tour', () => ({
  ProductTour: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/projects/create-project-form', () => ({
  CreateProjectForm: () => <div data-testid="create-project-form" />,
}))

const PROJECTS = [
  toOverviewProject(makeProject({ id: 'p1', name: 'Wohnbau Seestadt' })),
  toOverviewProject(makeProject({ id: 'p2', name: 'Bürohaus Lände 3' })),
]

let mounts = 0
function PageUnderneath(): JSX.Element {
  useEffect(() => {
    mounts += 1
  }, [])
  return (
    <Link href="/app/projects" onClick={(event) => overviewLinkClick('/app/projects', event)}>
      Projects
    </Link>
  )
}

const shell = (): JSX.Element => (
  <AppShellChrome
    projects={PROJECTS}
    projectActivity={{}}
    projectOverviewAfter={<div data-testid="recently-deleted" />}
    authRequired={false}
    canManageOrganization={false}
    canViewOrganization={false}
    canManagePlatform={false}
    canAccessOfficeShelf={false}
    canAccessInbox={false}
    showSkills={false}
    showModels={false}
    tours={{ welcome: false, project: false }}
    overlay={null}
  >
    <PageUnderneath />
  </AppShellChrome>
)

const overview = () => screen.queryByTestId('project-overview')

beforeEach(() => {
  mounts = 0
  push.mockClear()
  replace.mockClear()
  window.history.replaceState(null, '', '/app/projects/p1/files')
})

afterEach(() => {
  pathname = '/app/projects/p1/files'
  search = ''
  act(() => useProjectOverview.getState().setOpen(false))
})

describe('the project overview is a window of the shell, as search is', () => {
  test('a link to it opens it from the shell’s projects, navigating nowhere and leaving the page mounted', async () => {
    render(shell())
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }))
    const sheet = await screen.findByTestId('project-overview')
    expect(within(sheet).getAllByTestId('project-overview-card')).toHaveLength(2)
    expect(within(sheet).getAllByTestId('project-overview-card')[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('recently-deleted')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app/projects/p1/files')
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(mounts).toBe(1)
  })

  test('a modified click on the link is left to the browser, for a new tab', () => {
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: 'Projects' }), { metaKey: true })
    expect(overview()).toBeNull()
  })

  test('from the keyboard it stands at once, from a pointer it rises: as the search palette', async () => {
    render(shell())
    act(() => openProjectOverview({ summon: 'keyboard' }))
    expect(await screen.findByTestId('project-overview-window')).toHaveAttribute('data-instant', 'true')
    act(() => useProjectOverview.getState().setOpen(false))
    act(() => openProjectOverview({ summon: 'pointer' }))
    await waitFor(() => expect(screen.getByTestId('project-overview-window')).not.toHaveAttribute('data-instant'))
  })

  test('Escape closes it, the page underneath never remounted, and focus is back on the link', async () => {
    render(shell())
    const link = screen.getByRole('link', { name: 'Projects' })
    await userEvent.click(link)
    await screen.findByTestId('project-overview')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(overview()).toBeNull())
    expect(mounts).toBe(1)
    expect(link).toHaveFocus()
    expect(push).not.toHaveBeenCalled()
  })

  test('the close button closes it too', async () => {
    render(shell())
    act(() => openProjectOverview())
    await screen.findByTestId('project-overview')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(overview()).toBeNull())
  })

  test('„Neues Projekt“ opens it with the create dialog open', async () => {
    render(shell())
    act(() => openProjectOverview({ create: true }))
    expect(await screen.findByTestId('create-project-form')).toBeInTheDocument()
  })

  test('following a project out of it closes it', async () => {
    const { rerender } = render(shell())
    act(() => openProjectOverview())
    await screen.findByTestId('project-overview')
    pathname = '/app/projects/p2/chat'
    rerender(shell())
    await waitFor(() => expect(overview()).toBeNull())
  })

  test('following the current project’s own link closes it, though the path does not change', async () => {
    render(shell())
    act(() => openProjectOverview())
    const sheet = await screen.findByTestId('project-overview')
    const current = within(sheet).getAllByTestId('project-overview-card')[0]!
    fireEvent.click(within(current).getAllByRole('link')[0]!)
    await waitFor(() => expect(overview()).toBeNull())
  })

  test('/app/projects loaded directly (a bookmark, a feedback link) shows it at once over its own page', async () => {
    pathname = '/app/projects'
    render(shell())
    expect(await screen.findByTestId('project-overview-window')).toHaveAttribute('data-instant', 'true')
  })

  test('/app/projects/ with a trailing slash shows it too, never an empty page', async () => {
    pathname = '/app/projects/'
    render(shell())
    expect(await screen.findByTestId('project-overview-window')).toBeInTheDocument()
  })

  test('/app/projects?new=1 opens it with create open', async () => {
    pathname = '/app/projects'
    search = 'new=1'
    render(shell())
    expect(await screen.findByTestId('create-project-form')).toBeInTheDocument()
  })

  test('closing it on its own page goes to where the app opens', async () => {
    pathname = '/app/projects'
    render(shell())
    await screen.findByTestId('project-overview')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app'))
  })
})
