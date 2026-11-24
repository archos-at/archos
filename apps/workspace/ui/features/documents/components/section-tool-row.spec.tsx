import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { ProjectSectionActions, ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { FilesHeaderControls } from './files-header-controls'
import { FolderBreadcrumbRow } from './folder-navigation'
import { ProjectUppyUpload } from './project-uppy-upload'
import type { FolderItem } from '../file-types'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/projects/p1/files' }))
vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({ authRequired: true, fileUpload: { acceptedTypes: '.pdf', maxFileSize: 100 * 1e6 } }),
}))

const FOLDERS: FolderItem[] = [{ id: 'a', parentId: null, name: 'Grundlagen', path: '/Grundlagen' }]

function renderRow({ width, emptyLevel = false, shelfSource }: { width: number; emptyLevel?: boolean; shelfSource?: 'project' | 'personal' }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) })
  const onCreateFolder = vi.fn(async () => true)
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      <ProjectSectionActions>
        <FilesHeaderControls
          phone={false}
          view="cards"
          onViewChange={vi.fn()}
          shelfSource={shelfSource}
          renderFilter={(_compact, menu) => (menu?.open ? <span data-testid="filter-open" /> : null)}
          search={{ value: '', onChange: vi.fn(), onSubmit: vi.fn(), onClear: vi.fn() }}
          upload={<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />}
        />
      </ProjectSectionActions>
      <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={null} onNavigate={vi.fn()} onCreateFolder={onCreateFolder} emptyLevel={emptyLevel}>
        <button type="button">Select</button>
      </FolderBreadcrumbRow>
    </ProjectSectionFrame>
  )
  return { row: screen.getByTestId('files-tool-row'), onCreateFolder }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Dateien’s tool row', () => {
  it('reads search, the level’s tools, Hochladen and ⋯, in that order, with no folder press or view toggle on the row', () => {
    const { row } = renderRow({ width: 1100 })
    expect(row).toHaveAttribute('data-tier', 'wide')
    const presses = within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
    const select = presses.indexOf('Select')
    const upload = presses.findIndex((text) => text?.includes('Upload'))
    expect(select).toBeGreaterThanOrEqual(0)
    expect(upload).toBeGreaterThan(select)
    expect(presses.indexOf('More')).toBeGreaterThan(upload)
    expect(presses).not.toContain('Create folder')
    expect(within(row).queryByRole('group', { name: /view/i })).not.toBeInTheDocument()
  })

  it.each([1100, 700, 440])('keeps „Ordner anlegen“ in the ⋯ at %ipx, never in Hochladen’s menu', async (width) => {
    const { row, onCreateFolder } = renderRow({ width })
    await userEvent.click(within(row).getByRole('button', { name: /Upload/ }))
    expect(screen.queryByTestId('project-upload-new-folder')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(row).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByTestId('files-new-folder-item'))
    await userEvent.type(await screen.findByRole('textbox'), 'Statik{Enter}')
    expect(onCreateFolder).toHaveBeenCalledWith('Statik', undefined)
  })

  it('opens the filter from the ⋯', async () => {
    const { row } = renderRow({ width: 1100 })
    expect(screen.queryByTestId('filter-open')).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByTestId('files-filter-item'))
    expect(await screen.findByTestId('filter-open')).toBeInTheDocument()
  })

  it('folds Hochladen to its glyph on a narrow row, never a second line', () => {
    const { row } = renderRow({ width: 440 })
    expect(row).toHaveAttribute('data-tier', 'narrow')
    expect(within(row).getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Upload/ })).toHaveAttribute('title', 'Upload')
  })

  it('draws the tool row’s Hochladen as the outlined press', () => {
    const { row } = renderRow({ width: 1100 })
    expect(within(row).getByRole('button', { name: /Upload/ }).className).not.toMatch(/\bbg-primary\b/)
  })

  it('leaves the empty state’s own Hochladen its ink: only the tool row’s steps back', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1100, height: 32, top: 0, left: 0, right: 1100, bottom: 32, x: 0, y: 0, toJSON: () => ({}) })
    render(
      <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
        <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={null} onNavigate={vi.fn()} onCreateFolder={vi.fn(async () => true)} emptyLevel />
        <div data-testid="empty-state">
          <ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders />
        </div>
      </ProjectSectionFrame>
    )
    expect(within(screen.getByTestId('empty-state')).getByRole('button', { name: /Upload/ }).className).toMatch(/\bbg-primary\b/)
  })

  it('names the shelf it searches', () => {
    renderRow({ width: 1100, shelfSource: 'personal' })
    expect(screen.getByPlaceholderText('Search my files…')).toBeInTheDocument()
  })
})
