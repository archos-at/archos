import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { FolderBreadcrumbRow } from './folder-navigation'
import type { FolderItem } from '../file-types'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/projects/p1/files' }))
// A phone: every media query the frame asks (the phone's) answers yes.
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }))

/**
 * A phone inside a folder (review of 2026-11-10, finding 4): five levels deep the ← alone named no parent and offered
 * no way up two levels. One line above the title says where the folder is, without the project („… › Parent“), and
 * its „…“ opens the levels above.
 */
const folder = (id: string, parentId: string | null, name: string): FolderItem => ({ id, parentId, name, path: `/${name}` })
const FOLDERS: FolderItem[] = [
  folder('a', null, 'Grundlagen'),
  folder('b', 'a', 'Gutachten'),
  folder('c', 'b', 'Nachreichungen 2026'),
  folder('d', 'c', 'Fluchtwegnachweise Tiefgarage'),
  folder('e', 'd', 'Rauchabschnittsbildung_Bauteil_C_Index-D'),
]

function renderAt(currentFolderId: string, onNavigate = vi.fn()) {
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={currentFolderId} onNavigate={onNavigate} rootToolsElsewhere />
    </ProjectSectionFrame>
  )
  return onNavigate
}

describe('a phone’s crumb inside a folder', () => {
  it('names the parent, folds the levels above it into „…“, and names no project', async () => {
    const onNavigate = renderAt('e')
    const crumb = screen.getByTestId('page-header-crumb')
    expect(crumb).not.toHaveTextContent('Holzbau Wien')
    const trail = within(crumb).getByTestId('folder-trail-phone')
    expect(within(trail).getByRole('button', { name: 'Fluchtwegnachweise Tiefgarage' })).toBeInTheDocument()
    await userEvent.click(within(trail).getByTestId('folder-trail-phone-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Gutachten' }))
    expect(onNavigate).toHaveBeenCalledWith('b')
  })

  it('one level down, names the top level itself', () => {
    renderAt('a')
    expect(within(screen.getByTestId('folder-trail-phone')).getByRole('button', { name: 'Files' })).toBeInTheDocument()
  })
})
