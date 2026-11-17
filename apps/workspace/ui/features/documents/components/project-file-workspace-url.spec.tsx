import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import { FilePreviewHost } from './file-preview-host'
import type { DocumentWireRow } from '../lib/file-item'
import { SETTLING_POLL_MS } from '../hooks/use-settling-refresh'
import { useProjectDocuments } from '../hooks/use-project-documents'
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

describe('ProjectFileWorkspace — an .ifc opens as a building', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-model',
              filename: 'Haus-A.ifc',
              fileSize: 149_000_000,
              contentType: 'application/octet-stream',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-01T00:00:00Z',
              errorMessage: null,
            },
            {
              id: 'doc-pdf',
              filename: 'Einreichplan.pdf',
              fileSize: 2048,
              contentType: 'application/pdf',
              status: 'ready',
              folderId: null,
              createdAt: '2026-01-02T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      ),
      http.get('/api/documents/:id/preview', () => HttpResponse.json({ url: null })),
    )
  })

  it('opens the preview first, like every other file', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        showModels
      />
    )
    fireEvent.click(await findFileButton(/Haus-A\.ifc/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      routerPush.mock.calls.some((call) => String(call[0]).includes('model=Haus-A.ifc'))
    ).toBe(false)
  })

  it('leaves every other file opening the preview dialog', async () => {
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        showModels
      />
    )
    fireEvent.click(await findFileButton(/Einreichplan\.pdf/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('falls back to the ordinary preview when the org has no IFC feature', async () => {
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )
    fireEvent.click(await findFileButton(/Haus-A\.ifc/i))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })
})

describe('ProjectFileWorkspace — folders are addressable', () => {
  const FOLDERS = [
    { id: 'f-1', name: 'Planung', parentId: null },
    { id: 'f-2', name: 'Statik', parentId: 'f-1' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: FOLDERS })),
      http.get('/api/documents', () =>
        HttpResponse.json({
          documents: [
            {
              id: 'doc-in-folder',
              filename: 'Statikbericht.pdf',
              fileSize: 2048,
              contentType: 'application/pdf',
              status: 'ready',
              folderId: 'f-2',
              createdAt: '2026-01-02T00:00:00Z',
              errorMessage: null,
            },
          ],
        })
      )
    )
  })

  const render = () =>
    renderWorkspace(
      <ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />
    )

  it('opening a folder PUSHES it into the URL, so back means "up one level"', async () => {
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder “Planung”' }))

    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('folder')).toBe('f-1')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('reads the level back out of the URL, so a pasted link opens that folder', async () => {
    searchParams = new URLSearchParams('folder=f-2')
    render()

    expect(await screen.findByText(/Statikbericht/)).toBeInTheDocument()
  })

  it('offers a named way up, not just a breadcrumb to aim at', async () => {
    searchParams = new URLSearchParams('folder=f-2')
    render()

    const back = await screen.findByTestId('folder-back')
    expect(back).toHaveTextContent('Planung')

    fireEvent.click(back)
    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('folder')).toBe('f-1')
  })

  it('leaves the root with no way up, because there is nowhere to go', async () => {
    render()
    await screen.findByRole('button', { name: 'Open folder “Planung”' })
    expect(screen.queryByTestId('folder-back')).not.toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — the open file is on the URL', () => {
  const doc: DocumentWireRow = {
    id: 'doc-eg',
    filename: 'EG.pdf',
    displayName: null,
    fileSize: 10,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00.000Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: null,
    contentTypes: null,
    tags: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetPreviewStore()
    searchParams = new URLSearchParams()
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => HttpResponse.json({ documents: [doc], nextCursor: null })),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderAt(query = '') {
    searchParams = new URLSearchParams(query)
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[doc]}
      />,
    )
  }

  it('names the file it opened, so the link can be handed to somebody', async () => {
    renderAt()
    fireEvent.click(await findFileButton(/EG\.pdf/))

    await waitFor(() => expect(routerPush).toHaveBeenCalled())
    const href = String(routerPush.mock.calls.at(-1)?.[0])
    expect(new URLSearchParams(href.split('?')[1]).get('doc')).toBe('doc-eg')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('opens the file a link names', async () => {
    renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('closes the preview when the reader goes back', async () => {
    const { rerender } = renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    searchParams = new URLSearchParams()
    rerender(
      <>
        <ProjectFileWorkspace
          projectId="proj-1"
          projectName="Test"
          collectionName="test-coll"
          initialFiles={[doc]}
        />
        <FilePreviewHost />
      </>,
    )

    await waitFor(() => expect(useFilePreviewStore.getState().file).toBeNull())
  })

  it('drops the parameter when the preview is closed by its own control', async () => {
    renderAt('doc=doc-eg')
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    useFilePreviewStore.getState().close()

    await waitFor(() => expect(routerReplace).toHaveBeenCalled())
    const href = String(routerReplace.mock.calls.at(-1)?.[0])
    expect(href).not.toContain('doc=')
    await waitFor(() =>
      expect(screen.getByTestId('file-card').querySelector('[aria-current="true"]')).toBeNull(),
    )
  })
  it('brings the open modal along when the listing behind it refreshes', async () => {
    let documentCalls = 0
    server.use(
      http.get('/api/documents', () => {
        documentCalls += 1
        return HttpResponse.json({
          documents: [{ ...doc, status: 'ready', summary: 'Ein Grundriss.', pageCount: 2, tags: ['Grundriss'] }],
        })
      }),
      http.get('/api/documents/:id/status', () =>
        HttpResponse.json({ id: 'doc-eg', filename: 'EG.pdf', status: 'processing', summary: null }),
      ),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
    searchParams = new URLSearchParams('doc=doc-eg')
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[{ ...doc, status: 'processing' }]}
      />,
    )
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))

    vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(1))

    await waitFor(() =>
      expect(useFilePreviewStore.getState().file).toMatchObject({
        status: 'ready',
        summary: 'Ein Grundriss.',
        pageCount: 2,
        tags: ['Grundriss'],
      }),
    )
  })

  it('never moves the open modal back to settling on a stale listing', async () => {
    let documentCalls = 0
    server.use(
      http.get('/api/documents', () => {
        documentCalls += 1
        return HttpResponse.json({ documents: [{ ...doc, status: 'processing' }] })
      }),
      http.get('/api/documents/:id/status', () =>
        HttpResponse.json({ id: 'doc-eg', filename: 'EG.pdf', status: 'ready' }),
      ),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    searchParams = new URLSearchParams('doc=doc-eg')
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[{ ...doc, status: 'processing' }]}
      />,
    )
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-eg'))
    await vi.advanceTimersByTimeAsync(SETTLING_POLL_MS)
    await waitFor(() => expect(useFilePreviewStore.getState().file?.status).toBe('ready'))

    vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(1))
    await waitFor(() => expect(screen.getAllByText('Reading').length).toBeGreaterThan(0))

    expect(useFilePreviewStore.getState().file?.status).toBe('ready')
  })
})
