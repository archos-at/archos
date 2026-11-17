import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import { useProjectDocuments } from '../hooks/use-project-documents'
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

describe('ProjectFileWorkspace — a settling document settles on screen', () => {
  let documentCalls = 0
  let statusCalls = 0

  const corpus = (status: string, filename = 'Haus-A.ifc') =>
    HttpResponse.json({
      documents: [
        {
          id: 'doc-ifc',
          filename,
          fileSize: 148_900_000,
          contentType: 'application/octet-stream',
          status,
          folderId: null,
          createdAt: '2026-01-01T00:00:00Z',
          errorMessage: null,
        },
      ],
    })

  const statusOf = (status: string, filename = 'Haus-A.ifc') =>
    HttpResponse.json({ id: 'doc-ifc', filename, status })

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    documentCalls = 0
    statusCalls = 0
    resetPreviewStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-asks the settling row by id — not the whole corpus — and stops once it is terminal', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', ({ params }) => {
        statusCalls += 1
        expect(params.id).toBe('doc-ifc')
        return statusOf('ready')
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    expect(await screen.findByText('Reading')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4_100)
    await waitFor(() => expect(statusCalls).toBe(1))
    await waitFor(() => expect(screen.queryByText('Reading')).not.toBeInTheDocument())
    expect(documentCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(12_000)
    expect(statusCalls).toBe(1)
    expect(documentCalls).toBe(1)
  })

  it('keeps at most one poll in flight, however slow the endpoint is', async () => {
    let inFlight = 0
    let peak = 0
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', async () => {
        statusCalls += 1
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => (gate.release = resolve))
        inFlight -= 1
        return statusOf('processing')
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))

    await vi.advanceTimersByTimeAsync(13_000)
    expect(statusCalls).toBe(1)
    expect(peak).toBe(1)

    gate.release?.()
  })

  it('tells the user what became possible — a building is asked, not cited', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing')
      }),
      http.get('/api/documents/:id/status', () => statusOf('ready'))
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(4_100)

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/you can now ask about the building/i),
        expect.anything()
      )
    )
  })

  it('keeps the ordinary wording for an ordinary document', async () => {
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus('processing', 'Bescheid.pdf')
      }),
      http.get('/api/documents/:id/status', () => statusOf('ready', 'Bescheid.pdf'))
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    await waitFor(() => expect(documentCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(4_100)

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/citable/i),
        expect.anything()
      )
    )
  })

  it('reloads quietly, with one stable callback, when an upload finishes on any surface', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', async () => {
        documentCalls += 1
        if (documentCalls > 1) await new Promise<void>((resolve) => (gate.release = resolve))
        return corpus('ready', 'Bescheid.pdf')
      })
    )

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(await findFileButton(/Bescheid\.pdf/)).toBeInTheDocument()

    const onComplete = vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete
    onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(2))
    expect(await findFileButton(/Bescheid\.pdf/)).toBeInTheDocument()

    const callbacks = new Set(vi.mocked(useProjectDocuments).mock.calls.map(([options]) => options?.onComplete))
    expect(callbacks.size).toBe(1)

    gate.release?.()
  })
})

describe('ProjectFileWorkspace — only the newest answer may win', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const corpus = (status: string) =>
    HttpResponse.json({
      documents: [
        {
          id: 'doc-ifc',
          filename: 'Haus-A.ifc',
          fileSize: 148_900_000,
          contentType: 'application/octet-stream',
          status,
          folderId: null,
          createdAt: '2026-01-01T00:00:00Z',
          errorMessage: null,
        },
      ],
    })

  const flushWithoutPolling = async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50)
  }

  it('ignores a poll response that resolves after a newer foreground load', async () => {
    let documentCalls = 0
    let statusCalls = 0
    const gate: { release: (() => void) | null } = { release: null }
    server.use(
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
      http.get('/api/documents', () => {
        documentCalls += 1
        return corpus(documentCalls === 1 ? 'processing' : 'ready')
      }),
      http.get('/api/documents/:id/status', async () => {
        statusCalls += 1
        await new Promise<void>((resolve) => (gate.release = resolve))
        return HttpResponse.json({ id: 'doc-ifc', filename: 'Haus-A.ifc', status: 'processing' })
      })
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderWorkspace(<ProjectFileWorkspace projectId="proj-1" projectName="Test" collectionName="test-coll" />)
    expect(await screen.findByText('Reading')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4_100)
    await waitFor(() => expect(statusCalls).toBe(1))

    const onComplete = vi.mocked(useProjectDocuments).mock.calls.at(-1)?.[0]?.onComplete
    expect(onComplete).toBeTypeOf('function')
    onComplete?.()
    await waitFor(() => expect(documentCalls).toBe(2))
    await waitFor(() => expect(screen.queryByText('Reading')).not.toBeInTheDocument())

    gate.release?.()
    await flushWithoutPolling()

    expect(screen.queryByText('Reading')).not.toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(8_000)
    expect(statusCalls).toBe(1)
    expect(documentCalls).toBe(2)
  })
})
