import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import type { DocumentWireRow } from '../lib/file-item'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { findFileButton, renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

const mockUploadFiles = vi.fn()

const routerReplace = vi.fn()
const routerPush = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: (...args: unknown[]) => routerReplace(...args),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => searchParams,
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    loading: vi.fn(() => 'reading'),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: () => true,
}))

const media = vi.hoisted(() => ({ phone: false }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }))

vi.mock('@/features/bim/components/ifc-file-preview', () => ({
  IfcFilePreview: () => <div data-testid="ifc-file-preview" />,
}))

vi.mock('@/features/knowledge/components/pdf-viewer-dialog', () => ({
  PdfViewerDialog: () => null,
}))

vi.mock('../hooks/use-project-documents', () => ({
  useProjectDocuments: vi.fn().mockImplementation(() => ({
    uploadFiles: mockUploadFiles,
    retryFile: vi.fn(),
    isUploading: false,
    trackedFiles: [],
    error: null,
    clearError: vi.fn(),
  })),
}))

vi.mock('@/components/shell/project-section-frame', () => ({
  ProjectSectionActions: ({ children }: { children: ReactNode }) => children,
  ProjectSectionTabActions: () => null,
  useSectionTabActionsSlot: () => false,
  ProjectSectionPlace: () => null,
  useSectionPlaceSlot: () => false,
  useSectionToolTier: () => null,
  SectionLevelTools: () => null,
  useSectionNewFolder: () => null,
  useSectionPrimaryYields: () => false,
  useInSectionToolRow: () => false,
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

describe('ProjectFileWorkspace — mobile preview overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-1',
              filename: 'notes.txt',
              fileSize: 128,
              contentType: 'text/plain',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      ),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('renders the preview as a labelled modal dialog and closes on Escape', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const fileRow = await findFileButton(/notes\.txt/i)
    fireEvent.click(fileRow)

    const dialog = await screen.findByRole('dialog', { name: /File preview: notes\.txt/i })
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

async function startPicking(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByTestId('files-more'))
  await user.click(await screen.findByTestId('selection-start'))
}

describe('ProjectFileWorkspace — on a phone', () => {
  const photo = (id: string, filename: string): DocumentWireRow => ({
    id,
    filename,
    displayName: null,
    fileSize: 4_000_000,
    contentType: 'image/jpeg',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    assignees: [],
    authoredBy: 'user' as const,
  })
  const photos = [photo('p1', 'IMG_0001.jpg'), photo('p2', 'IMG_0002.jpg'), photo('p3', 'IMG_0003.jpg')]
  const folders = [{ id: 'f-site', name: 'Baustelle', parentId: null, path: '/Baustelle' }]

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    media.phone = true
    window.localStorage.clear()
    server.use(http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders })))
  })
  afterEach(() => {
    media.phone = false
    window.localStorage.clear()
  })

  const phoneWorkspace = (props: Partial<Parameters<typeof ProjectFileWorkspace>[0]> = {}) => (
    <ProjectFileWorkspace
      projectId="proj-1"
      projectName="Test"
      collectionName="test-coll"
      initialFiles={photos}
      initialFolders={folders}
      {...props}
    />
  )

  it('draws one row of controls: search and filter, the rest behind ⋯', () => {
    renderWorkspace(phoneWorkspace())
    const controls = screen.getByTestId('files-controls')
    expect(within(controls).getByRole('textbox', { name: /search/i })).toBeInTheDocument()
    expect(within(controls).getByTestId('file-filter-menu-trigger')).toBeInTheDocument()
    expect(within(controls).getByTestId('files-more')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull()
    expect(within(controls).queryByTestId('project-upload-input')).toBeNull()
  })

  it('puts the one upload control at the foot of the screen, under the thumb', () => {
    renderWorkspace(phoneWorkspace())
    const fab = screen.getByTestId('files-upload-fab')
    expect(within(fab).getByTestId('project-upload-input')).toBeInTheDocument()
    expect(screen.getAllByTestId('project-upload-input')).toHaveLength(1)
  })

  it('offers the upload nowhere to a reader who may only read', () => {
    renderWorkspace(phoneWorkspace({ initialRootAccess: 'read' }))
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()
  })

  it('keeps the desk’s row where there is room', () => {
    media.phone = false
    renderWorkspace(phoneWorkspace())
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()
    expect(screen.queryByTestId('files-more')).toBeNull()
  })

  it('moves the Outlook import behind ⋯ instead of a second header button', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace({ mailImportEnabled: true, initialRootAccess: 'write' }))
    expect(screen.queryByTestId('mail-import-trigger')).toBeNull()
    await user.click(screen.getByTestId('files-more'))
    expect(await screen.findByTestId('mail-import-trigger')).toBeInTheDocument()
  })

  it('turns the view with the ⋯ menu', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await user.click(screen.getByTestId('files-more'))
    await user.click(await screen.findByTestId('files-view-list'))
    expect(await screen.findByTestId('file-list-view')).toBeInTheDocument()
  })

  it('files several photos into a folder in one gesture, with one message', async () => {
    const user = userEvent.setup()
    const patched: Array<{ id: string; folderId: unknown }> = []
    server.use(
      http.patch('/api/documents/:id/folder', async ({ request, params }) => {
        patched.push({ id: String(params.id), folderId: ((await request.json()) as { folderId: unknown }).folderId })
        return HttpResponse.json({ ok: true })
      })
    )
    renderWorkspace(phoneWorkspace())

    await startPicking(user)
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument()
    expect(screen.getByTestId('selection-count')).toHaveTextContent('0 selected')
    const cards = screen.getAllByTestId('file-card')
    await user.click(cards[0]!)
    await user.click(cards[1]!)
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected')
    expect(useFilePreviewStore.getState().file).toBeNull()
    expect(screen.queryByTestId('files-upload-fab')).toBeNull()

    await user.click(screen.getByTestId('selection-move'))
    await user.click(await screen.findByTestId('folder-picker-f-site'))

    await waitFor(() => expect(patched).toHaveLength(2))
    expect(patched.every((call) => call.folderId === 'f-site')).toBe(true)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull())
  })

  it('selects every document of the level with „Alle"', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await startPicking(user)
    await user.click(screen.getByTestId('selection-all'))
    expect(screen.getByTestId('selection-count')).toHaveTextContent('3 selected')
  })

  it('ends the selection with „Fertig" and opens files again', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await startPicking(user)
    await user.click(screen.getByTestId('selection-done'))
    expect(screen.queryByTestId('selection-bar')).toBeNull()
    await user.click(screen.getAllByTestId('file-card')[0]!)
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBeDefined())
  })

  it('offers no selection where the reader may only read', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace({ initialRootAccess: 'read' }))
    await user.click(await screen.findByTestId('files-more'))
    expect(screen.queryByTestId('selection-start')).toBeNull()
    expect(screen.queryByTestId('files-new-folder')).toBeNull()
  })

  it('puts „Auswählen“ and „Ordner anlegen“ first in the ⋯ at the root, with no path row above the brief', async () => {
    const user = userEvent.setup()
    renderWorkspace(phoneWorkspace())
    await screen.findAllByTestId('file-card')
    expect(screen.queryByTestId('folder-breadcrumb-row')).toBeNull()
    await user.click(screen.getByTestId('files-more'))
    expect(await screen.findByTestId('selection-start')).toBeInTheDocument()
    expect(screen.getByTestId('files-new-folder')).toBeInTheDocument()
  })
})
