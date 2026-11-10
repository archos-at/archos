import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { FolderBreadcrumbRow } from './folder-navigation'
import { trailSteps } from './folder-trail'
import type { FolderItem } from '../file-types'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/projects/p1/files' }))

/**
 * Inside a folder the page's title names the folder and the crumb carries the way there. On dev (2026-11-10) the
 * header still said „All files“ over a folder's contents, and a path row under the tabs said the way back twice
 * („← Back to All Files   All Files › Berichte“), its labels wrapping and its long names cut without their text.
 */
const folder = (id: string, parentId: string | null, name: string): FolderItem => ({ id, parentId, name, path: `/${name}` })
const FOLDERS: FolderItem[] = [
  folder('a', null, 'Grundlagen'),
  folder('b', 'a', 'Gutachten'),
  folder('c', 'b', 'Brandschutzsachverständigengutachten'),
  folder('d', 'c', 'Stellungnahmen Baubehörde'),
  folder('e', 'd', 'Rauchabschnittsbildung_Bauteil_C_Index-D'),
]

function renderAt(currentFolderId: string | null, onNavigate = vi.fn()) {
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={currentFolderId} onNavigate={onNavigate} onCreateFolder={vi.fn()} />
    </ProjectSectionFrame>
  )
  return onNavigate
}

describe('a folder in the header', () => {
  it('titles the page with the folder, and „All files“ only at the root', () => {
    renderAt('b')
    expect(screen.getByRole('heading', { level: 1, name: 'Gutachten' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'All files' })).not.toBeInTheDocument()
  })

  it('carries the way there in the crumb, each step a way up, and draws no path row under the tabs', async () => {
    const onNavigate = renderAt('b')
    const crumb = screen.getByTestId('page-header-crumb')
    expect(crumb).toHaveTextContent('Holzbau Wien')
    const trail = within(crumb).getByTestId('folder-trail')
    expect(trail).toHaveTextContent('Files')
    expect(trail).toHaveTextContent('Grundlagen')
    // The open folder is the title, never a step of its own crumb.
    expect(trail).not.toHaveTextContent('Gutachten')
    await userEvent.click(within(trail).getByRole('button', { name: 'Grundlagen' }))
    expect(onNavigate).toHaveBeenCalledWith('a')
    expect(screen.queryByTestId('folder-breadcrumb-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('folder-back')).not.toBeInTheDocument()
    // The level's tools stand on the tabs' line, as at the root.
    expect(screen.getByRole('button', { name: /Create folder/ })).toBeInTheDocument()
  })

  it('keeps a step whole as its title when the crumb cuts it', () => {
    renderAt('d')
    const step = within(screen.getByTestId('folder-trail')).getByRole('button', { name: 'Brandschutzsachverständigengutachten' })
    expect(step).toHaveAttribute('title', 'Brandschutzsachverständigengutachten')
    expect(step.className).toMatch(/\btruncate\b/)
  })

  it('lets a long folder title wrap after its underscores, never after a hyphen, and reads it whole', () => {
    // A phone's title line broke „Rauchabschnittsbildung_Bauteil_C_Index-“ over a lone „D“.
    renderAt('e')
    const title = screen.getByRole('heading', { level: 1, name: 'Rauchabschnittsbildung_Bauteil_C_Index-D' })
    expect(title.querySelectorAll('wbr')).toHaveLength(3)
    expect(title.textContent).toContain('Index-\u2060D')
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
