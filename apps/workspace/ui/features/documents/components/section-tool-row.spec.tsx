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

function renderRow({ width, filterCount = 0 }: { width: number; filterCount?: number }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) })
  const onCreateFolder = vi.fn(async () => true)
  const onViewChange = vi.fn()
  render(
    <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien">
      <ProjectSectionActions>
        <FilesHeaderControls
          phone={false}
          view="cards"
          onViewChange={onViewChange}
          binHref="/app/projects/p1/files?bin=1"
          filterCount={filterCount}
          renderFilter={(_compact, anchored) => (
            <>
              {anchored?.anchor}
              {anchored?.open && <div data-testid="filter-open" />}
            </>
          )}
          search={{ value: '', onChange: vi.fn(), onSubmit: vi.fn(), onClear: vi.fn() }}
          upload={<ProjectUppyUpload onUpload={vi.fn()} isUploading={false} allowFolders onSendByMail={vi.fn()} onImportMailArchive={vi.fn()} />}
        />
      </ProjectSectionActions>
      <FolderBreadcrumbRow folders={FOLDERS} currentFolderId={null} onNavigate={vi.fn()} onCreateFolder={onCreateFolder}>
        <button type="button">Select</button>
      </FolderBreadcrumbRow>
    </ProjectSectionFrame>
  )
  return { row: screen.getByTestId('files-tool-row'), onCreateFolder, onViewChange }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Ablage’s tool row', () => {
  it('reads search, „Auswählen“, the bin, Hochladen, ⋯ and nothing else at every width', () => {
    for (const width of [1100, 700, 440]) {
      const { row } = renderRow({ width })
      const presses = within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
      const select = presses.indexOf('Select')
      expect(select, String(width)).toBeGreaterThanOrEqual(0)
      expect(presses.findIndex((text) => text?.includes('Upload')), String(width)).toBeGreaterThan(select)
      expect(presses.at(-1), String(width)).toBe('More')
      expect(within(row).getByRole('link', { name: 'Bin' })).toHaveAttribute('href', '/app/projects/p1/files?bin=1')
      expect(within(row).queryByRole('button', { name: /Create folder/ })).not.toBeInTheDocument()
      expect(within(row).queryByRole('button', { name: /^Filter/ })).not.toBeInTheDocument()
      expect(within(row).queryByRole('group', { name: /view/i })).not.toBeInTheDocument()
      document.body.innerHTML = ''
    }
  })

  it('never inks Hochladen: it is a raised press like the others', () => {
    const { row } = renderRow({ width: 1100 })
    expect(within(row).getByRole('button', { name: /Upload/ }).className).not.toMatch(/\bbg-primary\b/)
  })

  it('gathers every way into the Ablage under Hochladen, the e-mails among them, and no folder', async () => {
    const { row } = renderRow({ width: 1100 })
    await userEvent.click(within(row).getByRole('button', { name: /Upload/ }))
    expect(await screen.findByTestId('project-upload-files-item')).toBeInTheDocument()
    expect(screen.getByTestId('project-upload-send-by-mail')).toBeInTheDocument()
    expect(screen.getByTestId('project-upload-import-mail-archive')).toHaveTextContent('Import an Outlook archive')
    expect(screen.getByText('E-mails')).toBeInTheDocument()
    expect(screen.queryByTestId('project-upload-new-folder')).not.toBeInTheDocument()
  })

  it('keeps the view, „Filtern und sortieren“ and „Ordner anlegen“ behind the ⋯', async () => {
    const { row, onCreateFolder, onViewChange } = renderRow({ width: 1100 })
    await userEvent.click(within(row).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'List' }))
    expect(onViewChange).toHaveBeenCalledWith('list')

    await userEvent.click(within(row).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByTestId('files-filter-open'))
    expect(await screen.findByTestId('filter-open')).toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByTestId('files-new-folder'))
    await userEvent.type(await screen.findByRole('textbox'), 'Statik{Enter}')
    expect(onCreateFolder).toHaveBeenCalledWith('Statik', undefined)
  })

  it('says on the ⋯ that filters are on, since the filter has no press of its own', () => {
    const { row } = renderRow({ width: 1100, filterCount: 2 })
    expect(within(row).getByRole('button', { name: 'More, 2 filters active' })).toBeInTheDocument()
  })
})
