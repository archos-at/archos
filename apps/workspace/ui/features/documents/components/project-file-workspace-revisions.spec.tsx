import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ProjectFileWorkspace } from './project-file-workspace'
import type { DocumentWireRow } from '../lib/file-item'
import { PRODUCT_NAME } from '@/lib/brand'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { existing, findFileButton, renderWorkspace, resetPreviewStore } from './project-file-workspace.fixtures'

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

describe('ProjectFileWorkspace — a picked file the project already holds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
    server.use(
      http.get('/api/documents', () => HttpResponse.json({ documents: [existing] })),
      http.get('/api/projects/:projectId/folders', () => HttpResponse.json({ folders: [] })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithCorpus(files: DocumentWireRow[] = [existing]) {
    probeShelf = files
    return renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={files}
        initialFolders={[]}
      />,
    )
  }

  function pick(file: File) {
    const input = screen.getAllByTestId('project-upload-input')[0] as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
  }

  it('asks „new Fassung of X?" and uploads it on yes', async () => {
    renderWithCorpus()
    const revised = new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' })
    pick(revised)

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(within(dialog).getByText('New revision of “EG.pdf”?')).toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()

    const confirm = within(dialog).getByTestId('folder-upload-confirm')
    expect(confirm).toHaveTextContent('File as a new revision')
    await userEvent.click(confirm)

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledTimes(1))
    const [sent, options] = mockUploadFiles.mock.calls[0] as [
      File[],
      { folderIdFor: (file: File) => string | null },
    ]
    expect(sent).toEqual([revised])
    expect(options.folderIdFor(revised)).toBeNull()
  })

  it('sends nothing when the reader cancels', async () => {
    renderWithCorpus()
    pick(new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument())
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('says „unchanged – already here" for identical bytes and uploads nothing', async () => {
    const digest = `sha256:${'a'.repeat(64)}`
    renderWithCorpus([{ ...existing, fileSize: 4, contentHash: digest }])
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    })
    pick(new File(['same'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-unchanged'))
    expect(within(dialog).getByText('Unchanged – already here')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('folder-upload-confirm')).not.toBeInTheDocument()

    await userEvent.click(within(dialog).getByTestId('folder-upload-close'))
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('compares against the whole shelf while the authorship filter narrows the listing', async () => {
    const searches: string[] = []
    server.use(
      http.get('/api/documents', ({ request }) => {
        const search = new URL(request.url).search
        searches.push(search)
        return HttpResponse.json({ documents: search.includes('authoredBy=agent') ? [] : [existing] })
      }),
    )
    renderWithCorpus()

    await userEvent.click(screen.getByTestId('file-filter-menu-trigger'))
    await userEvent.click(await screen.findByLabelText(`By ${PRODUCT_NAME}`))
    await waitFor(() => expect(searches.at(-1)).toContain('authoredBy=agent'))
    await userEvent.keyboard('{Escape}')

    pick(new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('asks about a same-name document the loaded listing does not hold', async () => {
    renderWithCorpus([])
    probeShelf = [{ ...existing, lifecycle: 'archived' }]
    const revised = new File(['revised bytes'], 'EG.pdf', { type: 'application/pdf' })
    pick(revised)

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(dialog).toHaveAttribute('data-kind', 'single-update'))
    expect(probedNames.at(-1)).toEqual(['EG.pdf'])
    expect(within(dialog).getByTestId('folder-upload-archived')).toBeInTheDocument()
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('sends a name the shelf does not hold straight to the upload', async () => {
    renderWithCorpus()
    const fresh = new File(['x'], 'Neu.pdf', { type: 'application/pdf' })
    pick(fresh)

    await waitFor(() => expect(mockUploadFiles).toHaveBeenCalledWith([fresh], expect.objectContaining({ folderPathFor: expect.any(Function) })))
    expect(probedNames).toEqual([['Neu.pdf']])
    expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument()
  })

  it('says so when the comparison could not be made, and sends nothing', async () => {
    server.use(http.post('/api/documents/name-matches', () => HttpResponse.json({}, { status: 500 })))
    renderWithCorpus()
    pick(new File(['x'], 'EG.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('never asks the server about a name the office list holds back', async () => {
    renderWithCorpus()
    pick(new File(['x'], 'Lohnzettel_Mai_Huber.pdf', { type: 'application/pdf' }))

    const dialog = await screen.findByTestId('folder-upload-dialog')
    await waitFor(() => expect(within(dialog).getAllByText(/Lohnzettel_Mai_Huber\.pdf/).length).toBeGreaterThan(0))
    expect(probedNames).toEqual([])
    expect(mockUploadFiles).not.toHaveBeenCalled()
  })

  it('sends nothing, not even the name, while the office list cannot be read', async () => {
    server.use(http.get('/api/projects/:projectId/upload-screening', () => HttpResponse.json({}, { status: 500 })))
    renderWithCorpus()
    pick(new File(['x'], 'Notizen.pdf', { type: 'application/pdf' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Your office's list of sensitive data could not be loaded. Nothing was uploaded. Please try again.",
      ),
    )
    expect(probedNames).toEqual([])
    expect(mockUploadFiles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('folder-upload-dialog')).not.toBeInTheDocument()
  })
})

describe('ProjectFileWorkspace — Fassungen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    resetPreviewStore()
  })

  const row = (id: string, filename: string, revision: DocumentWireRow['revision']): DocumentWireRow =>
    ({
      id,
      filename,
      displayName: null,
      fileSize: 2048,
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
      assignees: [],
      authoredBy: 'user',
      revision,
    }) as DocumentWireRow

  it('lists one entry for a document and opens its older Fassung by id from the preview', async () => {
    const older = row('doc-v1', 'Gutachten_v1.pdf', {
      supersededBy: { id: 'doc-v2', filename: 'Gutachten_v2.pdf' },
      supersedes: [],
      suggestion: null,
      changeSummary: null,
    })
    const current = row('doc-v2', 'Gutachten_v2.pdf', {
      supersededBy: null,
      supersedes: [{ id: 'doc-v1', filename: 'Gutachten_v1.pdf' }],
      suggestion: null,
      changeSummary: null,
      history: [{ id: 'doc-v1', filename: 'Gutachten_v1.pdf', createdAt: null, changeSummary: null }],
    })
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[current, older]}
        initialFolders={[]}
      />,
    )

    expect(await findFileButton(/Gutachten_v2\.pdf/)).toBeInTheDocument()
    expect(screen.queryByText('Gutachten_v1.pdf')).not.toBeInTheDocument()

    fireEvent.click(await findFileButton(/Gutachten_v2\.pdf/))
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-v2'))

    act(() => useFilePreviewStore.getState().context.onOpenDocument?.('doc-v1'))
    expect(useFilePreviewStore.getState().file?.id).toBe('doc-v1')
  })

  it('moves BOTH listing entries when the preview confirms a link', async () => {
    const unlinked = { supersededBy: null, supersedes: [], suggestion: null, changeSummary: null }
    renderWorkspace(
      <ProjectFileWorkspace
        projectId="proj-1"
        projectName="Test"
        collectionName="test-coll"
        initialFiles={[
          row('doc-new', 'Statik_Entwurf.pdf', unlinked),
          row('doc-old', 'Tragwerk_Altstand.pdf', unlinked),
        ]}
        initialFolders={[]}
      />,
    )
    expect(await findFileButton(/Tragwerk_Altstand\.pdf/)).toBeInTheDocument()

    fireEvent.click(await findFileButton(/Statik_Entwurf\.pdf/))
    await waitFor(() => expect(useFilePreviewStore.getState().file?.id).toBe('doc-new'))

    const { onRevisionChanged } = useFilePreviewStore.getState().context
    act(() => {
      onRevisionChanged?.('doc-new', {
        ...unlinked,
        supersedes: [{ id: 'doc-old', filename: 'Tragwerk_Altstand.pdf' }],
      })
      onRevisionChanged?.('doc-old', {
        ...unlinked,
        supersededBy: { id: 'doc-new', filename: 'Statik_Entwurf.pdf' },
      })
    })

    await waitFor(() => expect(screen.queryByText('Tragwerk_Altstand.pdf')).not.toBeInTheDocument())
    expect(useFilePreviewStore.getState().file?.revision?.supersedes).toEqual([
      { id: 'doc-old', filename: 'Tragwerk_Altstand.pdf' },
    ])
  })
})
