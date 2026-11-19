import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode, type ComponentProps } from 'react'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { server } from '@/mocks/server'
import { shelfGet } from '@/test-utils/shelf-handlers'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { ROW_REVEAL } from '@/components/ui/row-hairline'
import type { FolderBinEntry, FolderBinListing } from '@/adapters/api/folder-bin-client'
import { FileCard } from './file-card'
import { FileListView } from './file-list-view'
import { FolderCard } from './folder-navigation'
import { FolderRow } from './folder-table-row'
import { FolderActionsTrigger, FolderObjectMenu } from './folder-object-menu'
import { FolderBinPanel } from './folder-bin-panel'
import { ProjectFileWorkspace } from './project-file-workspace'
import { renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'
import type { FileItem, FolderItem } from '../file-types'
import { emptyTally } from '../lib/folder-knowledge'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'reading'),
    dismiss: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => searchParams,
}))

vi.mock('../hooks/use-project-documents', () => ({
  useProjectDocuments: vi.fn().mockImplementation(() => ({
    uploadFiles: vi.fn(),
    retryFile: vi.fn(),
    isUploading: false,
    trackedFiles: [],
    error: null,
    clearError: vi.fn(),
  })),
}))

vi.mock('@/features/bim/components/ifc-file-preview', () => ({
  IfcFilePreview: () => createElement('div', { 'data-testid': 'ifc-file-preview' }),
}))

vi.mock('@/features/knowledge/components/pdf-viewer-dialog', () => ({
  PdfViewerDialog: () => null,
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

let searchParams = new URLSearchParams()

const LONG_NAME = 'Brandschutzkonzept Gebäude A Erdgeschoss Revision 07 final.pdf'
const LONG_FOLDER = 'Brandschutznachweise_Gebaeude_A_Erdgeschoss'

const doc = (filename: string, overrides: Partial<FileItem> = {}): FileItem => ({
  id: filename,
  filename,
  displayName: null,
  fileSize: 1_000,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-06-01T09:00:00Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  topics: null,
  capture: null,
  ...overrides,
})

const folder = (id: string, name: string): FolderItem => ({ id, parentId: null, name, path: name })

const layoutAt = (width: number): DOMRect =>
  ({ width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

const narrowNames = (): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layoutAt(120))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (value: string) => ({ width: value.length * 8 }),
  } as unknown as CanvasRenderingContext2D)
}

const onPhone = (phone: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

const fittedName = (text: string): HTMLElement => {
  const element = screen.getByText(text, { selector: '.sr-only' }).parentElement
  if (!element) throw new Error(`no fitted name for ${text}`)
  return element
}

const reveals = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('*')).filter((element) => element.classList.contains('md:opacity-0'))

const entry = (overrides: Partial<FolderBinEntry> = {}): FolderBinEntry => ({
  folderId: 'f-vertraege',
  name: 'Verträge',
  path: 'Verwaltung/Verträge',
  deletedAt: '2026-10-04T09:12:00Z',
  deletedBy: { userId: 'user_gf', name: 'Gerda Fischer' },
  purgeAfter: '2026-10-18T09:12:00Z',
  status: 'pending',
  documents: 14,
  folders: 2,
  canRestore: true,
  document: null,
  ...overrides,
})

const listing = (entries: FolderBinEntry[], rights: Partial<FolderBinListing> = {}): FolderBinListing => ({
  entries,
  canPurge: false,
  nextCursor: null,
  ...rights,
})

const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const inTable = (row: ReactNode): ReactElement => createElement('table', null, createElement('tbody', null, row))

beforeEach(() => {
  searchParams = new URLSearchParams()
  window.localStorage.clear()
  server.use(
    http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    http.get('/api/office-shelf/folders', () => HttpResponse.json({ folders: [] })),
    shelfGet('project', '/api/documents', () =>
      HttpResponse.json({
        documents: [{ ...doc(LONG_NAME), id: 'doc-1', status: 'completed', tags: ['Brandschutz'] }],
      })
    ),
    http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a file name keeps its end', () => {
  beforeEach(() => narrowNames())

  it('a card draws its name fitted: a long name is cut, read once in full, and a tile keeps two lines for it', () => {
    const { container } = render(
      createElement(FileCard, { file: doc(LONG_NAME), isSelected: false, onSelect: vi.fn(), locale: 'de' })
    )

    const name = fittedName(LONG_NAME)
    expect(name).toHaveAttribute('data-fitted', 'cut')
    expect(name).toHaveAttribute('title', LONG_NAME)
    expect(screen.getAllByText(LONG_NAME, { selector: '.sr-only' })).toHaveLength(1)
    expect(name.querySelectorAll('[aria-hidden]')).toHaveLength(2)
    expect(container.querySelector('.break-all')).toBeNull()
  })

  it('a list row draws the name fitted, the same rule as a card', () => {
    render(
      createElement(FileListView, {
        files: [doc(LONG_NAME)],
        selectedFileId: null,
        onSelectFile: vi.fn(),
      })
    )

    expect(fittedName(LONG_NAME)).toHaveAttribute('data-fitted', 'cut')
  })

  it('a folder is named on one line, cut at its end with its whole name as its title', () => {
    render(
      createElement(FolderCard, {
        folder: folder('F1', LONG_FOLDER),
        itemCount: 3,
        onOpen: vi.fn(),
        onRenameFolder: vi.fn(async () => true),
        onDeleteFolder: vi.fn(async () => true),
      })
    )

    const name = screen.getByTitle(LONG_FOLDER)
    expect(name).toHaveClass('truncate')
  })

  it('a folder row names it the same way', () => {
    render(
      inTable(
        createElement(FolderRow, {
          folder: folder('F2', LONG_FOLDER),
          itemCount: 3,
          onOpen: vi.fn(),
          onRenameFolder: vi.fn(async () => true),
          onDeleteFolder: vi.fn(async () => true),
        })
      )
    )

    expect(screen.getByTitle(LONG_FOLDER)).toHaveClass('truncate')
  })

  it('does not cut a document name with a bare `truncate` and a title', () => {
    render(createElement(FileCard, { file: doc(LONG_NAME), isSelected: false, onSelect: vi.fn(), locale: 'de' }))
    for (const element of screen.queryAllByTitle(LONG_NAME)) expect(element).not.toHaveClass('truncate')
  })
})

describe('a hover reveal has a second way in on the pointer axis', () => {
  it('a file card shows its actions to a finger', () => {
    const { container } = render(
      createElement(FileCard, {
        file: doc(LONG_NAME),
        isSelected: false,
        onSelect: vi.fn(),
        locale: 'de',
        actions: createElement('button', { type: 'button' }, 'Aktionen'),
      })
    )

    const found = reveals(container)
    expect(found.length).toBeGreaterThan(0)
    for (const reveal of found) expect(reveal.classList).toContain('pointer-coarse:opacity-100')
  })

  it('a folder card shows its ⋯ to a finger', () => {
    const { container } = render(
      createElement(FolderCard, {
        folder: folder('F1', 'Pläne'),
        itemCount: 2,
        onOpen: vi.fn(),
        onRenameFolder: vi.fn(async () => true),
        onDeleteFolder: vi.fn(async () => true),
      })
    )

    const found = reveals(container)
    expect(found.length).toBeGreaterThan(0)
    for (const reveal of found) expect(reveal.classList).toContain('pointer-coarse:opacity-100')
  })

  it('the folder menu trigger shows itself to a finger', () => {
    const { container } = render(
      createElement(
        FolderObjectMenu,
        {
          folder: { id: 'F1', name: 'Pläne', parentId: null },
          folders: [],
          onOpen: vi.fn(),
          onRename: vi.fn(),
          onDelete: vi.fn(),
        } as unknown as ComponentProps<typeof FolderObjectMenu>,
        createElement(FolderActionsTrigger)
      )
    )

    const found = reveals(container)
    expect(found.length).toBeGreaterThan(0)
    for (const reveal of found) expect(reveal.classList).toContain('pointer-coarse:opacity-100')
  })
})

describe('the phone header', () => {
  const renderProject = () =>
    renderWorkspace(createElement(ProjectFileWorkspace, { projectId: 'proj-1', projectName: 'Test', collectionName: 'test-coll' }))

  it('does not pin its controls to their natural width', async () => {
    onPhone(true)
    resetPreviewStore()
    renderProject()

    await waitFor(() => expect(screen.getByTestId('files-upload-fab')).toBeInTheDocument())
    expect(document.querySelectorAll('.flex.min-w-0.shrink-0.flex-wrap')).toHaveLength(0)
  })

  it('keeps one upload control, and moves it rather than copying it', async () => {
    onPhone(true)
    resetPreviewStore()
    renderProject()
    await waitFor(() => expect(screen.getByTestId('files-upload-fab')).toBeInTheDocument())
    const uploads = screen.getAllByRole('button', { name: /upload/i })
    expect(uploads).toHaveLength(1)
    expect(uploads[0].closest('[data-testid="files-upload-fab"]')).not.toBeNull()
  })
})

describe('the folder tile on a phone', () => {
  it('is a 56px sheet in the grid’s two columns, its ⋯ at its end, no chevron', () => {
    const tile = (id: string, name: string) =>
      createElement(FolderCard, {
        folder: folder(id, name),
        itemCount: 2,
        knowledge: emptyTally(),
        onOpen: vi.fn(),
        onRenameFolder: vi.fn(async () => true),
        onDeleteFolder: vi.fn(async () => true),
      })
    render(createElement('div', null, tile('P', 'Pläne'), tile('Q', 'Schnitte')))

    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-folder-tile]'))
    expect(tiles).toHaveLength(2)
    for (const element of tiles) {
      expect(element.classList).not.toContain('col-span-full')
      expect(element.querySelector('.h-14')?.classList).toContain('flex')
    }

    const menu = screen.getByTestId('folder-actions-P').closest('.absolute')
    expect(menu?.classList).toContain('-translate-y-1/2')
    expect(menu?.classList).toContain('phone:right-1.5')

    const chevron = tiles[0].querySelector('[data-slot="folder-opens"]')
    expect(chevron?.classList).toContain('phone:hidden')
    expect(chevron).toHaveAttribute('aria-hidden')
  })
})

describe('the Papierkorb', () => {
  it('keeps the permanent action two deliberate steps from restore: a menu, then a confirm', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? answer(200, { status: 'purged', counts: { documents: 14, folders: 2, memoryNotes: 0, answers: 0, conversations: 0, reports: 0, tracesErased: 0 } })
        : answer(200, listing([]))
    )
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(FolderBinPanel, { projectId: 'p1', initial: listing([entry()], { canPurge: true }) }))

    expect(screen.getByTestId('bin-restore-f-vertraege')).toBeDefined()
    expect(screen.queryByTestId('bin-purge-f-vertraege')).toBeNull()

    const actions = screen.getByTestId('bin-actions-f-vertraege')
    for (const token of ROW_REVEAL.split(/\s+/).filter(Boolean)) expect(actions.classList).toContain(token)

    await userEvent.click(actions)
    const purge = await screen.findByTestId('bin-purge-f-vertraege')
    expect(purge.className).toMatch(/destructive/)
    await userEvent.click(purge)
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByTestId('bin-purge-confirm'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/bin/f-vertraege'))).toBe(true)
    )
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('the list keeps its columns at a laptop’s width and says them on a phone', () => {
  it('steps Größe and the head in from a 36rem list and Hinzugefügt from 42rem', () => {
    render(createElement(FileListView, { files: [doc('Plan_1.pdf')], selectedFileId: null, onSelectFile: vi.fn() }))

    expect(document.querySelector('thead')?.classList).toContain('@xl/filelist:table-header-group')
    const cells = Array.from(screen.getAllByTestId('file-list-row')[0].querySelectorAll('td'))
    expect(cells.some((cell) => cell.classList.contains('@xl/filelist:table-cell'))).toBe(true)
    expect(cells.some((cell) => cell.classList.contains('@2xl/filelist:table-cell'))).toBe(true)
  })

  it('pins the head in the pane’s scroll, so the table does not scroll sideways on its own', () => {
    render(createElement(FileListView, { files: [doc('Plan_1.pdf')], selectedFileId: null, onSelectFile: vi.fn() }))

    const table = document.querySelector('table')
    expect(table?.parentElement?.classList).not.toContain('overflow-x-auto')
  })

  it('says size and age on a narrow row’s second line, for files and folders alike', () => {
    const { unmount } = render(
      createElement(FileListView, { files: [doc('Plan_1.pdf')], selectedFileId: null, onSelectFile: vi.fn() })
    )
    const fileMeta = screen.getByTestId('file-list-meta')
    expect(fileMeta.classList).toContain('@xl/filelist:hidden')
    unmount()

    const { container } = render(
      inTable(
        createElement(FolderRow, {
          folder: folder('F1', 'Pläne'),
          itemCount: 2,
          lastModified: '2026-06-01T09:00:00Z',
          knowledge: emptyTally(),
          onOpen: vi.fn(),
          onRenameFolder: vi.fn(async () => true),
          onDeleteFolder: vi.fn(async () => true),
        })
      )
    )
    const folderMeta = Array.from(container.querySelectorAll('span')).find((span) =>
      span.classList.contains('@xl/filelist:hidden')
    )
    expect(folderMeta).toBeDefined()
    expect(within(container).getByText('Pläne')).toBeInTheDocument()
    const dateCell = Array.from(container.querySelectorAll('td')).find((cell) =>
      cell.classList.contains('@2xl/filelist:table-cell')
    )
    expect(dateCell?.textContent).not.toBe('—')
  })
})
