import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { ProjectSectionActions, ProjectSectionFrame, SectionLevelTools } from '@/components/shell/project-section-frame'
import { FolderBreadcrumbRow } from './folder-navigation'
import { trailSteps } from './folder-trail'
import type { FolderItem } from '../file-types'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/projects/p1/files' }))

const folder = (id: string, parentId: string | null, name: string): FolderItem => ({ id, parentId, name, path: `/${name}` })
const FOLDERS: FolderItem[] = [
  folder('a', null, 'Grundlagen'),
  folder('b', 'a', 'Gutachten'),
  folder('c', 'b', 'Brandschutzsachverständigengutachten'),
  folder('d', 'c', 'Stellungnahmen Baubehörde'),
  folder('e', 'd', 'Rauchabschnittsbildung_Bauteil_C_Index-D'),
]

function renderAt(currentFolderId: string | null, onNavigate = vi.fn(), itemCount?: number) {
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      {/* The header's tool row, where `FilesHeaderControls` draws the level's tools. */}
      <ProjectSectionActions>
        <SectionLevelTools />
      </ProjectSectionActions>
      <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={currentFolderId} onNavigate={onNavigate} onCreateFolder={vi.fn()} itemCount={itemCount} />
    </ProjectSectionFrame>
  )
  return onNavigate
}

describe('a folder in the Ablage (KAN-86)', () => {
  it('keeps the head standing: the title stays „Documents“ and the crumb says whose Ablage it is', () => {
    renderAt('b')
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByTestId('page-header-crumb')).toHaveTextContent(/^Holzbau Wien·Project team$/)
  })

  it('draws the way there in a line under the places, the open folder in ink with what it holds', () => {
    renderAt('b', vi.fn(), 240)
    const line = screen.getByTestId('section-place-line')
    expect(within(line).getByTestId('section-place-current')).toHaveTextContent('Gutachten')
    expect(within(line).getByTestId('section-place-current')).toHaveAttribute('title', 'Gutachten')
    expect(within(line).getByTestId('page-header-count')).toHaveTextContent('240 items')
  })

  it('makes every step of the line a way up, the ← one level, and draws no path row in the pane', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1100, height: 32, top: 0, left: 0, right: 1100, bottom: 32, x: 0, y: 0, toJSON: () => ({}) })
    const onNavigate = renderAt('b')
    const trail = within(screen.getByTestId('section-place-line')).getByTestId('folder-trail')
    expect(trail).toHaveTextContent('Documents')
    expect(trail).toHaveTextContent('Grundlagen')
    expect(trail).not.toHaveTextContent('Gutachten')
    await userEvent.click(within(trail).getByRole('button', { name: 'Grundlagen' }))
    expect(onNavigate).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByTestId('page-header-up'))
    expect(onNavigate).toHaveBeenLastCalledWith('a')
    expect(screen.queryByTestId('folder-breadcrumb-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-back')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('files-tool-row')).queryByRole('button', { name: /Create folder/ })).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('draws no line at the top level', () => {
    renderAt(null)
    expect(screen.queryByTestId('section-place-line')).not.toBeInTheDocument()
  })

  it('keeps a step whole as its title when the crumb cuts it', () => {
    renderAt('d')
    const step = within(screen.getByTestId('folder-trail')).getByRole('button', { name: 'Brandschutzsachverständigengutachten' })
    expect(step).toHaveAttribute('title', 'Brandschutzsachverständigengutachten')
    expect(step.className).toMatch(/\btruncate\b/)
  })

  it('collapses the middle of a deep path into „…“, keeping the first level and the parent', () => {
    renderAt('e')
    const trail = screen.getByTestId('folder-trail')
    expect(within(trail).getByRole('button', { name: 'Grundlagen' })).toBeInTheDocument()
    expect(within(trail).getByRole('button', { name: 'Stellungnahmen Baubehörde' })).toBeInTheDocument()
    expect(within(trail).getByTestId('folder-trail-more')).toHaveAttribute('aria-label', '2 more levels')
    expect(within(trail).queryByRole('button', { name: 'Gutachten' })).not.toBeInTheDocument()
  })
})

describe('trailSteps', () => {
  it('shows up to two levels between the shelf and the open folder, else the first, „…“ and the parent', () => {
    expect(trailSteps(FOLDERS.slice(0, 1))).toEqual({ shown: [], hidden: [] })
    expect(trailSteps(FOLDERS.slice(0, 3)).shown.map((f) => f.id)).toEqual(['a', 'b'])
    const deep = trailSteps(FOLDERS)
    expect(deep.shown.map((f) => f.id)).toEqual(['a', 'd'])
    expect(deep.hidden.map((f) => f.id)).toEqual(['b', 'c'])
  })
})
