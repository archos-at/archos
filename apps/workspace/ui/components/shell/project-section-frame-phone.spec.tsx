import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { ProjectSectionActions, ProjectSectionFrame } from './project-section-frame'

let pathname = '/app/projects/p1/files/mail'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }))

function show(path: string): () => void {
  pathname = path
  return render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien" inboundMail>
      <ProjectSectionActions onTitleLine>
        <button type="button">Address</button>
      </ProjectSectionActions>
      <p>body</p>
    </ProjectSectionFrame>,
  ).unmount
}

describe('the Ablage’s head on a phone', () => {
  test('every place is titled „Ablage“, the open place named by its tab, and its one ⋯ stands on the title’s line', () => {
    for (const path of ['/app/projects/p1/files/mail', '/app/projects/p1/files/open-points']) {
      const unmount = show(path)
      expect(screen.getByRole('heading', { level: 1 }), path).toHaveTextContent(/^Documents$/)
      const titleLine = screen.getByRole('banner').querySelector('[data-slot="page-header-title-line"]')
      expect(titleLine, path).toContainElement(screen.getByRole('button', { name: 'Address' }))
      expect(screen.queryByTestId('files-tool-row'), path).toBeNull()
      unmount()
    }
  })

  test('an opened mail is titled by its place, as a folder titles the phone’s page', () => {
    show('/app/projects/p1/files/mail/m1')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Project mail$/)
  })
})
