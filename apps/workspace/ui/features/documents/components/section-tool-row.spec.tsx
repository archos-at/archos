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

/**
 * Dateien's tool row (review of 2026-11-10, findings 1, 2, 8 and 19): one row under the tabs that never wraps, the
 * level's tools in it before Hochladen, „Ordner anlegen“ in Hochladen's menu where the row has no room for it, and
 * Hochladen the raised press while an empty level's own Hochladen is the pane's one ink press.
 */
const FOLDERS: FolderItem[] = [{ id: 'a', parentId: null, name: 'Grundlagen', path: '/Grundlagen' }]

/** The row measures itself: every box reports `width`, as a section that wide would. */
function renderRow({ width, emptyLevel = false }: { width: number; emptyLevel?: boolean }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) })
  const onCreateFolder = vi.fn(async () => true)
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      <ProjectSectionActions>
        <FilesHeaderControls
          phone={false}
          view="cards"
          onViewChange={vi.fn()}
          renderFilter={() => null}
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
  it('holds the level’s tools before Hochladen, every press with its words on a wide row', () => {
    const { row } = renderRow({ width: 1100 })
    expect(row).toHaveAttribute('data-tier', 'wide')
    const presses = within(row).getAllByRole('button').map((button) => button.textContent)
    const select = presses.indexOf('Select')
    expect(select).toBeGreaterThanOrEqual(0)
    expect(presses.indexOf('Create folder')).toBe(select + 1)
    expect(presses.findIndex((text) => text?.includes('Upload'))).toBeGreaterThan(select + 1)
  })

  it('moves „Ordner anlegen“ into Hochladen’s menu where the row has no room for it, and keeps „Auswählen“ worded', async () => {
    const { row, onCreateFolder } = renderRow({ width: 700 })
    expect(row).toHaveAttribute('data-tier', 'medium')
    expect(within(row).queryByRole('button', { name: /Create folder/ })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Select' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: /Upload/ }))
    await userEvent.click(await screen.findByTestId('project-upload-new-folder'))
    await userEvent.type(await screen.findByRole('textbox'), 'Statik{Enter}')
    expect(onCreateFolder).toHaveBeenCalledWith('Statik', undefined)
  })

  it('folds the view into the ⋯ and Hochladen to its glyph on a narrow row, never a second line', () => {
    const { row } = renderRow({ width: 440 })
    expect(row).toHaveAttribute('data-tier', 'narrow')
    expect(within(row).queryByRole('group', { name: /view/i })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Upload/ })).toHaveAttribute('title', 'Upload')
  })

  it('steps Hochladen back to the raised press while the empty level’s own Hochladen shows', () => {
    const { row } = renderRow({ width: 1100, emptyLevel: true })
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

  it('keeps Hochladen the ink press where the level has something in it', () => {
    const { row } = renderRow({ width: 1100 })
    expect(within(row).getByRole('button', { name: /Upload/ }).className).toMatch(/\bbg-primary\b/)
  })
})
