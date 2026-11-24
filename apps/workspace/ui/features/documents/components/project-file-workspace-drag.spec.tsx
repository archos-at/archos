import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import { FOLDER_DRAG_TYPE } from '../hooks/use-document-drag'
import { makeDataTransfer, renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

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

describe('ProjectFileWorkspace — dragging a file into a folder', () => {
  const dragTransfer = (documentId: string) => {
    const store: Record<string, string> = { 'application/x-document-id': documentId }
    return {
      types: ['application/x-document-id'],
      items: [{ kind: 'string', type: 'application/x-document-id' }],
      getData: (key: string) => store[key] ?? '',
      setData: (key: string, value: string) => {
        store[key] = value
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () =>
        HttpResponse.json({ folders: [{ id: 'folder-1', name: 'Brandschutz', parentId: null }] })
      ),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-1',
              filename: 'plan.pdf',
              displayName: null,
              fileSize: 1024,
              contentType: 'application/pdf',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
              summary: null,
              pageCount: null,
              chunkCount: null,
              contentTypes: null,
              tags: null,
            },
          ],
        })
      ),
      http.patch('/api/documents/:id/folder', () => HttpResponse.json({ ok: true }))
    )
  })

  it('moves the file through the same endpoint the menu uses', async () => {
    const patched: Array<{ url: string; body: unknown }> = []
    server.use(
      http.patch('/api/documents/:id/folder', async ({ request, params }) => {
        patched.push({ url: String(params.id), body: await request.json() })
        return HttpResponse.json({ ok: true })
      })
    )

    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const folder = await screen.findByTestId('folder-card-folder-1')
    fireEvent.dragOver(folder, { dataTransfer: dragTransfer('doc-1') })
    fireEvent.drop(folder, { dataTransfer: dragTransfer('doc-1') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'doc-1', body: { folderId: 'folder-1' } })
  })

  it('says why when the server refuses an IFC model into a restricted folder (ADR-0087)', async () => {
    server.use(
      http.patch('/api/documents/:id/folder', () =>
        HttpResponse.json(
          { error: 'IFC models cannot be filed in a restricted folder yet', code: 'CONFLICT', details: { code: 'IFC_IN_RESTRICTED_FOLDER', models: 1 } },
          { status: 409 },
        )
      )
    )
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const folder = await screen.findByTestId('folder-card-folder-1')
    fireEvent.dragOver(folder, { dataTransfer: dragTransfer('doc-1') })
    fireEvent.drop(folder, { dataTransfer: dragTransfer('doc-1') })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be filed in a folder not everyone may read yet'))
    )
  })

  it('does not raise the upload overlay for a drag that started in the page', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const dropzone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(dropzone, { dataTransfer: dragTransfer('doc-1') })

    expect(screen.queryByTestId('workspace-drop-overlay')).not.toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('still raises it for a real upload', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    const dropzone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(dropzone, {
      dataTransfer: makeDataTransfer([new File(['x'], 'plan.pdf', { type: 'application/pdf' })]),
    })

    expect(screen.getByTestId('workspace-drop-overlay')).toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — dragging a folder into a folder', () => {
  const folders = [
    { id: 'f-a', name: 'Brandschutz', parentId: null, path: 'Brandschutz' },
    { id: 'f-b', name: 'Statik', parentId: null, path: 'Statik' },
    { id: 'f-a1', name: 'Fluchtwege', parentId: 'f-a', path: 'Brandschutz/Fluchtwege' },
  ]

  const folderDragTransfer = (folderId: string) => {
    const store: Record<string, string> = { [FOLDER_DRAG_TYPE]: folderId }
    return {
      types: [FOLDER_DRAG_TYPE, `${FOLDER_DRAG_TYPE}:${folderId}`],
      items: [{ kind: 'string', type: FOLDER_DRAG_TYPE }],
      getData: (key: string) => store[key] ?? '',
      setData: (key: string, value: string) => {
        store[key] = value
      },
    }
  }

  let patched: Array<{ url: string; body: unknown }>

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    patched = []
    server.use(
      http.get('/api/documents', () => HttpResponse.json({ documents: [] })),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders })),
      http.patch('/api/projects/:projectId/folders/:folderId', async ({ request, params }) => {
        patched.push({ url: String(params.folderId), body: await request.json() })
        return HttpResponse.json({ folder: { id: params.folderId } })
      }),
    )
  })

  function renderWithFolders() {
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[]}
        initialFolders={folders}
      />,
    )
  }

  it('re-parents the dragged folder', async () => {
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-b')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'f-a', body: { parentId: 'f-b' } })
  })

  it('says why when the server refuses moving IFC models under a restriction (ADR-0087)', async () => {
    server.use(
      http.patch('/api/projects/:projectId/folders/:folderId', () =>
        HttpResponse.json(
          { error: 'IFC models cannot be filed in a restricted folder yet', code: 'CONFLICT', details: { code: 'IFC_IN_RESTRICTED_FOLDER', models: 1 } },
          { status: 409 },
        )
      )
    )
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-b')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be filed in a folder not everyone may read yet'))
    )
  })

  it('refuses a folder dropped on itself', async () => {
    renderWithFolders()
    const target = screen.getByTestId('folder-card-f-a')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    expect(target).not.toHaveAttribute('data-drop-over')

    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })
    await waitFor(() => expect(patched).toHaveLength(0))
  })

  it('refuses a folder dropped into its own descendant', async () => {
    searchParams = new URLSearchParams('folder=f-a')
    renderWithFolders()
    const target = await screen.findByTestId('folder-card-f-a1')

    fireEvent.dragOver(target, { dataTransfer: folderDragTransfer('f-a') })
    expect(target).not.toHaveAttribute('data-drop-over')

    fireEvent.drop(target, { dataTransfer: folderDragTransfer('f-a') })
    await waitFor(() => expect(patched).toHaveLength(0))
  })

  it('moves a nested folder back out through the breadcrumb root', async () => {
    searchParams = new URLSearchParams('folder=f-a')
    renderWithFolders()

    const root = await screen.findByRole('button', { name: 'All Files' })
    fireEvent.dragOver(root, { dataTransfer: folderDragTransfer('f-a1') })
    fireEvent.drop(root, { dataTransfer: folderDragTransfer('f-a1') })

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ url: 'f-a1', body: { parentId: null } })
  })
})
