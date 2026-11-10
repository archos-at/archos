import { describe, expect, test, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@/test-utils'
import type { ReactNode } from 'react'
import { ProjectSectionActions, ProjectSectionBack, ProjectSectionFrame } from './project-section-frame'

let pathname = '/app/projects/p1/files'

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}))

beforeEach(() => {
  pathname = '/app/projects/p1/files'
})

describe('ProjectSectionFrame', () => {
  test('renders the section heading, no breadcrumb', () => {
    pathname = '/app/projects/p1/automation'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>files body</p>
      </ProjectSectionFrame>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Automation' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).not.toBeInTheDocument()
    expect(screen.getByText('files body')).toBeInTheDocument()
  })

  test('a settings sub-route is still titled by its section, not by its last segment', () => {
    // `/settings/members` ends in `members`, which is also the legacy Members
    // return target; the section is the segment after the project id.
    pathname = '/app/projects/p1/settings/members'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>members body</p>
      </ProjectSectionFrame>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  test('renders children only on the chat route — no page heading', () => {
    pathname = '/app/projects/p1/chat'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>chat body</p>
      </ProjectSectionFrame>,
    )

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Stadthaus Wien' })).not.toBeInTheDocument()
    expect(screen.getByText('chat body')).toBeInTheDocument()
  })

  test('places ProjectSectionActions in the header', () => {
    pathname = '/app/projects/p1/automation'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <ProjectSectionActions>
          <button type="button">New skill</button>
        </ProjectSectionActions>
        <p>automation body</p>
      </ProjectSectionFrame>,
    )

    const action = screen.getByRole('button', { name: 'New skill' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Automation' })
    expect(heading.closest('header')).toContainElement(action)
  })

  test("Dateien's places are tabs: the E-Mail-Eingang only for whoever may decide the project's mail, the open one current", () => {
    pathname = '/app/projects/p1/files/mail'
    const { unmount } = render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
        <p>mail body</p>
      </ProjectSectionFrame>,
    )
    const tabs = screen.getByTestId('files-tabs')
    const names = Array.from(tabs.querySelectorAll('a')).map((link) => link.textContent)
    expect(names).toEqual(['All files', 'Project mail', 'Open points', 'Bin'])
    expect(screen.getByRole('link', { name: 'Project mail' })).toHaveAttribute('aria-current', 'page')
    // The open place is the title, under a muted crumb of the project and the section: „Files“ over the inbox
    // was a headline that said nothing the rail did not, and no standing subtitle explains the place.
    expect(screen.getByRole('heading', { level: 1, name: 'Project mail' })).toBeInTheDocument()
    expect(screen.getByTestId('page-header-crumb')).toHaveTextContent('Stadthaus WienFiles')
    expect(screen.getByRole('banner').querySelector('h1 + p')).toBeNull()
    unmount()

    pathname = '/app/projects/p1/files'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>files body</p>
      </ProjectSectionFrame>,
    )
    expect(screen.queryByRole('link', { name: 'Project mail' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All files' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'All files' })).toBeInTheDocument()
  })

  // Below `md` there is no rail, and no project name above the page: it starts with its title, whose line holds the
  // way back and the app's search. The founder (2026-11-10): „on mobile lets remove it entirely“.
  describe('the header below the rail’s width', () => {
    const show = (path: string, children: ReactNode = <p>body</p>) => {
      pathname = path
      return render(
        <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
          {children}
        </ProjectSectionFrame>,
      )
    }
    const titleLine = (): HTMLElement => screen.getByRole('banner').querySelector<HTMLElement>('[data-slot="page-header-title-line"]')!

    test('shows no project name: no crumb outside Dateien, and Dateien’s is the desk’s alone', () => {
      show('/app/projects/p1/automation')
      expect(screen.queryByTestId('page-header-crumb')).toBeNull()
      expect(screen.getByRole('banner')).not.toHaveTextContent('Stadthaus Wien')
      cleanup()

      show('/app/projects/p1/files/points')
      expect(screen.getByTestId('page-header-crumb')).toHaveClass('max-md:hidden')
    })

    test('ends the title’s line with the app’s search, below the rail’s width only', () => {
      show('/app/projects/p1/automation')
      expect(titleLine().querySelector('h1')).toHaveTextContent('Automation')
      expect(titleLine().lastElementChild!.querySelector('[data-testid="shell-search"]')).toHaveClass('md:hidden')
      expect(screen.getAllByTestId('shell-search')).toHaveLength(1)
    })

    test('Alle Dateien has its own search field, so its title’s line carries no second magnifier', () => {
      show('/app/projects/p1/files')
      expect(screen.queryByTestId('shell-search')).toBeNull()
      cleanup()
      show('/app/projects/p1/files/mail')
      expect(screen.getByTestId('shell-search')).toBeInTheDocument()
    })

    test('a page under the Übersicht has its way back at the start of the title’s line', () => {
      show('/app/projects/p1/settings/members')
      const back = screen.getByTestId('page-header-back')
      expect(titleLine().firstElementChild).toContainElement(back)
      expect(back).toHaveAttribute('href', '/app/projects/p1/settings')
      expect(back).toHaveAccessibleName('Back to Overview')
      expect(back).toHaveClass('size-11', 'md:hidden')
      expect(titleLine().firstElementChild).toHaveClass('md:hidden')
    })

    test('Dateien’s places are tabs and have no way back; an opened mail hands the header its own, the one arrow', () => {
      show('/app/projects/p1/files/bin')
      expect(screen.queryByTestId('page-header-back')).toBeNull()
      cleanup()

      show('/app/projects/p1/files/mail/m1', <ProjectSectionBack href="/app/projects/p1/files/mail?status=handled" to="Project mail" />)
      const back = screen.getByTestId('page-header-back')
      expect(titleLine().firstElementChild).toContainElement(back)
      expect(back).toHaveAttribute('href', '/app/projects/p1/files/mail?status=handled')
      expect(back).toHaveAccessibleName('Back to Project mail')
      // The page's own link shows from the widths where the frame's arrow does not: a phone gets the header's.
      expect(back).toHaveClass('hidden', 'phone:flex')
      // Its slot hides with it: an empty slot kept the line's 8px gap and moved „E-Mail-Eingang“ off the crumb's edge.
      expect(titleLine().firstElementChild).toHaveClass('hidden', 'phone:flex')
    })
  })
})
