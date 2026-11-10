import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test-utils'
import { ProjectSectionActions, ProjectSectionFrame } from './project-section-frame'

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
})
