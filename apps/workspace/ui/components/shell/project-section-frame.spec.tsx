import { describe, expect, test, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@/test-utils'
import type { ReactNode } from 'react'
import { ProjectSectionActions, ProjectSectionBack, ProjectSectionFrame, ProjectSectionTabs } from './project-section-frame'
import { primeInboundMailWaiting, resetInboundMailWaitingForTests } from '@/hooks/use-inbound-mail-waiting'

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
    pathname = '/app/projects/p1/settings/members'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>members body</p>
      </ProjectSectionFrame>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Project settings' })).toBeInTheDocument()
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

  test("the Ablage's places are words: the E-Mail-Eingang only for whoever may decide the project's mail, the open one current, the bin no place", () => {
    pathname = '/app/projects/p1/files/mail'
    const { unmount } = render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
        <p>mail body</p>
      </ProjectSectionFrame>,
    )
    const tabs = screen.getByTestId('files-tabs')
    const names = Array.from(tabs.querySelectorAll('a')).map((link) => link.textContent)
    expect(names).toEqual(['Files', 'Project mail', 'Open points'])
    expect(screen.getByRole('link', { name: 'Project mail' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByTestId('page-header-crumb')).toHaveTextContent(/^Stadthaus Wien·Project team$/)
    expect(screen.getByRole('banner').querySelector('h1 + p')).toBeNull()
    unmount()

    pathname = '/app/projects/p1/files'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <p>files body</p>
      </ProjectSectionFrame>,
    )
    expect(screen.queryByRole('link', { name: 'Project mail' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByTestId('page-header-crumb')).toHaveTextContent(/^Stadthaus Wien·Project team$/)
    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '/app/projects/p1/files')
  })

  test('the E-Mail-Eingang tab writes its count as the list and the rail do, „50+“ when the read stopped at a page', () => {
    pathname = '/app/projects/p1/files/mail'
    primeInboundMailWaiting('p1', { count: 50, more: true })
    const { unmount } = render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
        <p>mail body</p>
      </ProjectSectionFrame>,
    )
    const tab = screen.getByRole('link', { name: /Project mail/ })
    expect(tab).toHaveTextContent('Project mail50+')
    expect(within(tab).getByTitle('More than 50 mails wait to be filed')).toBeInTheDocument()
    unmount()
    primeInboundMailWaiting('p1', { count: 9, more: false })
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
        <p>mail body</p>
      </ProjectSectionFrame>,
    )
    expect(screen.getByRole('link', { name: /Project mail/ })).toHaveTextContent(/^Project mail9$/)
    resetInboundMailWaitingForTests()
  })

  test('Dateien’s tools are one row under the tabs, never on the title’s line', () => {
    pathname = '/app/projects/p1/files'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien">
        <ProjectSectionActions>
          <button type="button">Upload</button>
        </ProjectSectionActions>
        <p>files body</p>
      </ProjectSectionFrame>,
    )
    const row = screen.getByTestId('files-tool-row')
    expect(row).toContainElement(screen.getByRole('button', { name: 'Upload' }))
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toContainElement(screen.getByRole('button', { name: 'Upload' }))
  })

  test('the Ablage’s head stands still: every place has its crumb, its title and its tool row, a place’s own tools at the row’s end (KAN-86)', () => {
    for (const path of ['/app/projects/p1/files', '/app/projects/p1/files/mail', '/app/projects/p1/files/mail/m1', '/app/projects/p1/files/open-points']) {
      pathname = path
      const { unmount } = render(
        <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
          <p>body</p>
        </ProjectSectionFrame>,
      )
      expect(screen.getByRole('heading', { level: 1 }), path).toHaveTextContent(/^Documents$/)
      expect(screen.getByTestId('page-header-crumb'), path).toHaveTextContent(/^Stadthaus Wien·Project team$/)
      const row = screen.getByTestId('files-tool-row')
      expect(row, path).toHaveClass('h-9')
      expect(row.nextElementSibling, path).toContainElement(screen.getByTestId('files-tabs'))
      unmount()
    }

    pathname = '/app/projects/p1/files/mail'
    render(
      <ProjectSectionFrame projectId="p1" projectName="Stadthaus Wien" inboundMail>
        <ProjectSectionActions onTitleLine>
          <button type="button">Copy address</button>
        </ProjectSectionActions>
        <p>mail body</p>
      </ProjectSectionFrame>,
    )
    const tool = screen.getByRole('button', { name: 'Copy address' })
    expect(screen.getByTestId('files-tool-row')).toContainElement(tool)
    expect(tool.parentElement).toHaveClass('ml-auto')
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toContainElement(tool)
  })

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

    test('a section’s own tabs stand in the header, under the title, and no sentence stands over them', async () => {
      show('/app/projects/p1/settings', <ProjectSectionTabs><nav aria-label="places">tabs</nav></ProjectSectionTabs>)
      const slot = await screen.findByTestId('section-tabs-slot')
      expect(slot).toContainElement(await screen.findByRole('navigation', { name: 'places' }))
      expect(screen.getByRole('banner').parentElement).toContainElement(slot)
      expect(screen.getByRole('banner').querySelector('p.text-sm')).toBeNull()
      cleanup()

      render(<ProjectSectionTabs><nav aria-label="places">tabs</nav></ProjectSectionTabs>)
      expect(screen.getByRole('navigation', { name: 'places' })).toBeInTheDocument()
    })

    test('shows no project name: every section’s crumb is the desk’s alone', () => {
      show('/app/projects/p1/automation')
      expect(screen.getByTestId('page-header-crumb')).toHaveClass('max-md:hidden')
      cleanup()

      show('/app/projects/p1/files/points')
      expect(screen.getByTestId('page-header-crumb')).toHaveClass('max-md:hidden')
    })

    test('leaves the search to the phone’s floating buttons: no title line carries a magnifier', () => {
      for (const path of ['/app/projects/p1/automation', '/app/projects/p1/files', '/app/projects/p1/files/mail']) {
        show(path)
        expect(screen.queryByTestId('shell-search')).toBeNull()
        cleanup()
      }
    })

    test('a page under the Übersicht has its way back at the start of the title’s line', () => {
      show('/app/projects/p1/settings/members')
      const back = screen.getByTestId('page-header-back')
      expect(titleLine().firstElementChild).toContainElement(back)
      expect(back).toHaveAttribute('href', '/app/projects/p1/settings')
      expect(back).toHaveAccessibleName('Back to Project settings')
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
      expect(back).toHaveClass('hidden', 'phone:flex')
      expect(titleLine().firstElementChild).toHaveClass('hidden', 'phone:flex')
    })
  })
})
