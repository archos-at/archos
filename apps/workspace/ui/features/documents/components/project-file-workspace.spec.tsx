import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import type { DocumentWireRow } from '../lib/file-item'
import { handOverDroppedFiles, takeDroppedFiles } from '../lib/dropped-file-handover'
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

let probeShelf: DocumentWireRow[] = []
let probedNames: string[][] = []

beforeEach(() => {
  probeShelf = []
  probedNames = []
  server.use(
    http.post('/api/documents/name-matches', async ({ request }) => {
      const { names } = (await request.json()) as { names: string[] }
      probedNames.push(names)
      const fold = (name: string) => name.normalize('NFC').trim().toLowerCase()
      const wanted = new Set(names.map(fold))
      const documents = probeShelf
        .filter((doc) => doc.authoredBy !== 'agent')
        .filter((doc) => [doc.filename, doc.displayName].some((name) => name && wanted.has(fold(name))))
        .map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          displayName: doc.displayName ?? null,
          fileSize: doc.fileSize,
          contentHash: doc.contentHash ?? null,
          status: doc.status ?? 'completed',
          folderId: doc.folderId ?? null,
          authoredBy: doc.authoredBy ?? 'user',
          lifecycle: doc.lifecycle ?? 'active',
        }))
      return HttpResponse.json({ documents })
    }),
  )
})

describe('ProjectFileWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  it('renders the file workspace with view controls and upload', () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeDefined()
    expect(screen.getByTestId('project-upload-input')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Test' })).toBeNull()
  })

  it('offers no upload where the reader may only read (ADR-0088), and says so to a dropped file instead of taking it', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFolders={[]}
        initialRootAccess="read"
      />,
    )
    expect(screen.queryByTestId('project-upload-input')).toBeNull()
    const dataTransfer = makeDataTransfer([new File(['x'], 'plan.pdf', { type: 'application/pdf' })])
    const zone = screen.getByTestId('workspace-dropzone')
    fireEvent.dragEnter(zone, { dataTransfer })
    const overlay = screen.getByTestId('workspace-drop-overlay')
    expect(overlay).toHaveAttribute('data-refused')
    expect(overlay).toHaveTextContent(/read only/i)

    fireEvent.drop(zone, { dataTransfer })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('workspace-drop-overlay')).toBeNull()
  })

  it('shows the drop overlay on dragover of a supported file', () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const dataTransfer = makeDataTransfer([
      new File(['x'], 'plan.pdf', { type: 'application/pdf' }),
    ])

    fireEvent.dragEnter(dropzone, { dataTransfer })

    expect(screen.getByTestId('workspace-drop-overlay')).toBeInTheDocument()
    expect(screen.getByText(/drop files to upload/i)).toBeInTheDocument()
  })

  it('routes a dropped file into the existing upload path (uploadFiles)', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    const dataTransfer = makeDataTransfer([file])

    fireEvent.dragEnter(dropzone, { dataTransfer })
    fireEvent.drop(dropzone, { dataTransfer })

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    expect(mockUploadFiles).toHaveBeenCalledWith([file], expect.objectContaining({ folderPathFor: expect.any(Function) }))
    expect(screen.queryByTestId('workspace-drop-overlay')).not.toBeInTheDocument()
  })

  it('flags an unsupported drag but still defers rejection to uploadFiles, like the button', async () => {
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    const dropzone = screen.getByTestId('workspace-dropzone')
    const badFile = new File(['x'], 'photo.png', { type: 'image/png' })
    const dataTransfer = makeDataTransfer([badFile])

    fireEvent.dragEnter(dropzone, { dataTransfer })
    expect(screen.getByText(/not a supported type/i)).toBeInTheDocument()

    fireEvent.drop(dropzone, { dataTransfer })
    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([badFile], expect.objectContaining({ folderPathFor: expect.any(Function) })))
  })

  it('uploads a drop made elsewhere in the project once it arrives, and only once', async () => {
    server.use(http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })))
    takeDroppedFiles('proj-1')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    handOverDroppedFiles('proj-1', [file])

    const { unmount } = renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([file], expect.objectContaining({ folderPathFor: expect.any(Function) })))
    unmount()
    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockUploadFiles).toHaveBeenCalledTimes(1)
  })

  it('holds a handed-over drop while the folders it is planned against failed to load', async () => {
    server.use(http.get('/api/projects/:projectId/folders', () => new HttpResponse(null, { status: 500 })))
    takeDroppedFiles('proj-1')
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' })
    handOverDroppedFiles('proj-1', [file])

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)

    await waitFor(() => expect(screen.getByText(/folders/i)).toBeInTheDocument())
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(takeDroppedFiles('proj-1')).toEqual([file])
  })
})

describe('ProjectFileWorkspace — the mail import action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  const workspace = (rootAccess?: 'read' | 'write') => (
    <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" mailImportEnabled initialRootAccess={rootAccess} />
  )

  it('offers the import to a reader who may write at the project root, where it files its folder', () => {
    renderWorkspace(workspace('write'))
    expect(screen.getByTestId('mail-import-trigger')).toBeDefined()
  })

  it('hides it from a reader whose root access is read (ADR-0088)', () => {
    renderWorkspace(workspace('read'))
    expect(screen.queryByTestId('mail-import-trigger')).toBeNull()
  })
})
